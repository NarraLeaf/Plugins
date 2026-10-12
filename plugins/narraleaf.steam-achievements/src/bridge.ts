/**
 * Two things every node stands on: the local mirror, and the Steam bridge.
 *
 * **The local mirror is the source of truth.** Every write node writes it first
 * and every read node reads only it. Steam is a best-effort *echo* of that
 * mirror, never a source — which is what makes the same script work on Steam, on
 * itch, on the web export, in Dev Mode, and on a dev machine with Steam closed.
 * Degradation is the design, not a fallback path bolted on afterwards. Each new
 * connection to Steam replays the mirror's unlocked achievements, so one earned
 * while Steam was closed reaches it the next time the game starts with Steam.
 *
 * The mirror lives in `app.game.store` (the `store` runtime capability): plugin
 * storage kept beside the player's saves, so it survives starting a new game —
 * which is exactly the lifetime an achievement needs. It is absent in the
 * editor, where there is no player; reads then degrade to "nothing unlocked" and
 * writes are dropped with one warning.
 */

import type { PluginBlueprintNodeDef } from "narraleaf-studio/plugin";
import {
    SIDECAR_ID,
    STORE_KEY_PROGRESS,
    STORE_KEY_STATS,
    STORE_KEY_UNLOCKED,
} from "./catalog";

export type ExecuteCtx = Parameters<PluginBlueprintNodeDef["execute"]>[0];

type Game = ExecuteCtx["game"];

/* ------------------------------------------------------------------ mirror */

export type ProgressMirror = Record<string, { current: number; max: number }>;

let warnedNoStore = false;

function store(game: Game) {
    if (game.store) {
        return game.store;
    }
    if (!warnedNoStore) {
        warnedNoStore = true;
        game.log("warning", "Achievements are not persisted here: plugin storage is unavailable.");
    }
    return null;
}

export async function readUnlocked(game: Game): Promise<Set<string>> {
    const raw = await store(game)?.get<unknown>(STORE_KEY_UNLOCKED);
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : []);
}

export async function writeUnlocked(game: Game, unlocked: Set<string>): Promise<void> {
    await store(game)?.set(STORE_KEY_UNLOCKED, Array.from(unlocked));
}

export async function readStats(game: Game): Promise<Record<string, number>> {
    const raw = await store(game)?.get<unknown>(STORE_KEY_STATS);
    const values: Record<string, number> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof value === "number" && Number.isFinite(value)) {
                values[id] = value;
            }
        }
    }
    return values;
}

export async function writeStats(game: Game, values: Record<string, number>): Promise<void> {
    await store(game)?.set(STORE_KEY_STATS, values);
}

export async function readProgress(game: Game): Promise<ProgressMirror> {
    const raw = await store(game)?.get<unknown>(STORE_KEY_PROGRESS);
    const progress: ProgressMirror = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
            const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
            const current = record && typeof record.current === "number" ? record.current : null;
            const max = record && typeof record.max === "number" ? record.max : null;
            if (current !== null && max !== null) {
                progress[id] = { current, max };
            }
        }
    }
    return progress;
}

export async function writeProgress(game: Game, progress: ProgressMirror): Promise<void> {
    await store(game)?.set(STORE_KEY_PROGRESS, progress);
}

/* ------------------------------------------------------------------ bridge */

export type SteamStatus = {
    available: boolean;
    appId: string | null;
    language: string | null;
};

const UNAVAILABLE: SteamStatus = { available: false, appId: null, language: null };

type Handle = Awaited<ReturnType<NonNullable<Game["sidecar"]>["start"]>>;

/**
 * One connection per game process, memoized.
 *
 * A failure is remembered for the whole session rather than retried per node:
 * the host already owns crash restarts with backoff, so retrying here would only
 * stack a second, dumber retry loop on top of it — and a game that calls an
 * achievement node in a loop would spam the log with the same failure forever.
 */
let connection: Promise<{ handle: Handle; status: SteamStatus } | null> | null = null;
let dead = false;

/**
 * `appId` is the authored catalog's Steam App ID, and it is only read on the
 * call that actually opens the connection — everything after that reuses the
 * memoized handle. It is handed to the sidecar rather than left to the author
 * because the sidecar is the only half of this plugin with a filesystem and an
 * environment: see `steam::publish_app_id` in the Rust source.
 */
function connect(game: Game, appId: string | null): Promise<{ handle: Handle; status: SteamStatus } | null> {
    if (dead) {
        return Promise.resolve(null);
    }
    // Absent on the web and mobile shells (no process to spawn), on desktop
    // targets the plugin ships no binary for, and in the editor.
    const sidecar = game.sidecar;
    if (!sidecar || !sidecar.available(SIDECAR_ID)) {
        dead = true;
        return Promise.resolve(null);
    }
    connection ??= sidecar.start(SIDECAR_ID)
        .then(async handle => {
            handle.onExit(info => {
                // The host restarts per the manifest's `restart` policy; once it
                // gives up the handle stays dead, so stop echoing to Steam and
                // let the mirror carry the game.
                dead = true;
                connection = null;
                game.log("info", `Steam bridge exited (code ${String(info.code)}); achievements stay local.`);
            });
            // `steam.init` both delivers the App ID and reports the result of
            // SteamAPI_Init, so opening the connection costs one round trip.
            const reply = await handle.request<SteamStatus>("steam.init", { appId });
            const status: SteamStatus = {
                available: reply?.available === true,
                appId: typeof reply?.appId === "string" ? reply.appId : null,
                language: typeof reply?.language === "string" ? reply.language : null,
            };
            // Before any node's own echo, so the first write of the session lands
            // on a Steam that already knows everything the mirror does.
            if (status.available) {
                await replayUnlocked(game, handle);
            }
            return { handle, status };
        })
        .catch((error: unknown) => {
            dead = true;
            game.log("info", `Steam bridge unavailable (${describe(error)}); achievements stay local.`);
            return null;
        });
    return connection;
}

/**
 * Send Steam every achievement the mirror holds.
 *
 * The mirror is written whether Steam is there or not, so a player who starts the
 * game from a desktop shortcut with Steam closed still earns the achievement, on
 * this device only. Steam would otherwise hear of it only if the same node ran
 * again, which for a story beat is never. Unlocking is idempotent on Steam's
 * side, so replaying the whole set on every connection costs a few calls and
 * closes every gap at once.
 *
 * Stats are not replayed. A value is absolute, and this device's copy would
 * overwrite a higher one Steam holds from another machine.
 */
async function replayUnlocked(game: Game, handle: Handle): Promise<void> {
    // A mirror that cannot be read costs the replay, not the connection: the
    // writes this session makes still have a Steam to reach.
    let unlocked: Set<string>;
    try {
        unlocked = await readUnlocked(game);
    } catch (error) {
        game.log("warning", `Steam replay skipped: ${describe(error)}`);
        return;
    }
    for (const id of unlocked) {
        try {
            await handle.request("achievements.unlock", { id });
        } catch (error) {
            game.log("warning", `Steam achievements.unlock failed for ${id}: ${describe(error)}`);
        }
    }
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Open the connection at game start when the mirror holds anything to replay.
 *
 * The connection is otherwise opened by the first node that needs Steam, and in a
 * story whose next achievement is a chapter away, an unlock earned with Steam
 * closed would wait that long. Only a game that has already unlocked something
 * starts the bridge early; one that has unlocked nothing still spawns no process
 * until a node asks.
 */
export async function connectIfUnlocked(game: Game, appId: string | null): Promise<void> {
    if ((await readUnlocked(game)).size > 0) {
        await connect(game, appId);
    }
}

/** Steam's view of the world, or the all-false answer when there is no Steam. */
export async function steamStatus(game: Game, appId: string | null): Promise<SteamStatus> {
    return (await connect(game, appId))?.status ?? UNAVAILABLE;
}

/**
 * Ask Steam something and wait for the answer.
 *
 * The opposite of {@link echo} in the one way that matters: an echo is a write whose success was
 * already decided by the mirror, so dropping it costs nothing. This is a READ, and there is no
 * mirror to fall back on - nothing local knows what a player owns. So the caller is handed `null`
 * for "could not ask", which is a third answer it has to decide about, rather than a `false` that
 * would be indistinguishable from "does not own it".
 *
 * Never throws, for the reason every node here does not: the caller is drawing a menu.
 */
export async function ask<T>(
    game: Game,
    appId: string | null,
    method: string,
    params?: unknown,
): Promise<T | null> {
    const active = await connect(game, appId);
    if (!active || !active.status.available) {
        return null;
    }
    try {
        return await active.handle.request<T>(method, params) ?? null;
    } catch (error) {
        game.log("warning", `Steam ${method} failed: ${describe(error)}`);
        return null;
    }
}

/**
 * Echo one call to Steam. Never throws and never blocks the story: a failed echo
 * is a log line, because the mirror write that preceded it already made the node
 * succeed.
 */
export async function echo(
    game: Game,
    appId: string | null,
    method: string,
    params?: unknown,
): Promise<void> {
    const active = await connect(game, appId);
    if (!active || !active.status.available) {
        return;
    }
    try {
        await active.handle.request(method, params);
    } catch (error) {
        game.log("warning", `Steam ${method} failed: ${describe(error)}`);
    }
}
