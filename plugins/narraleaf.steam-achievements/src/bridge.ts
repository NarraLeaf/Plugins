/**
 * Two things every node stands on: the local mirror, and the Steam bridge.
 *
 * **The local mirror is the source of truth.** Every write node writes it first
 * and every read node reads only it. Steam is a best-effort *echo* of that
 * mirror, never a source — which is what makes the same script work on Steam, on
 * itch, on the web export, in Dev Mode, and on a dev machine with Steam closed.
 * Degradation is the design, not a fallback path bolted on afterwards.
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
            const status = await handle.request<SteamStatus>("steam.init", { appId });
            return {
                handle,
                status: {
                    available: status?.available === true,
                    appId: typeof status?.appId === "string" ? status.appId : null,
                    language: typeof status?.language === "string" ? status.language : null,
                },
            };
        })
        .catch((error: unknown) => {
            dead = true;
            game.log("info", `Steam bridge unavailable (${describe(error)}); achievements stay local.`);
            return null;
        });
    return connection;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
