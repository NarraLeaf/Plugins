/**
 * Blueprint node definitions, shared by both plugin entries:
 * - main.tsx (studio) registers the full defs for the editor palette, reading
 *   the live catalog out of the editor tab's store.
 * - runtime.ts registers the same defs in game environments, reading the copy
 *   published with the game through `contributes.runtimeData`.
 *
 * Every value-producing node is `isPure: false` with exec pins: pure nodes are
 * resolved by the host's own data resolver, which only knows built-in types, so
 * a pure plugin node's execute would never run.
 *
 * The whole of a node's reach is `ctx.game` — the capability-gated surface the
 * manifest declared. There is no `hostAdapter` here, by construction.
 */

import type { PluginBlueprintNodeDef } from "narraleaf-studio/plugin";
import {
    PLUGIN_ID,
    clampStatValue,
    findStat,
    normalizeCatalog,
    type AchievementCatalog,
} from "./catalog";
import {
    ask,
    echo,
    readProgress,
    readStats,
    readUnlocked,
    steamStatus,
    writeProgress,
    writeStats,
    writeUnlocked,
    type ExecuteCtx,
} from "./bridge";

export { PLUGIN_ID, CATALOG_NAMESPACE, SIDECAR_ID } from "./catalog";

/** Dynamic select option source ids; the studio entry provides both. */
export const ACHIEVEMENT_OPTIONS_SOURCE = `${PLUGIN_ID}.achievements`;
export const STAT_OPTIONS_SOURCE = `${PLUGIN_ID}.stats`;

const PARAM_ACHIEVEMENT = "achievementId";
const PARAM_STAT = "statId";
const PIN_ACHIEVEMENT_ID = "achievementIdIn";
const PIN_STAT_ID = "statIdIn";
const PIN_VALUE = "value";
const PIN_CURRENT = "current";
const PIN_MAX = "max";
const PIN_ALSO_ACHIEVEMENTS = "alsoAchievements";

/**
 * A Steam App ID typed on the node, used by the two DLC-facing nodes.
 *
 * Typed rather than picked, unlike every other reference in this plugin: a DLC's App ID is issued by
 * Steamworks and exists nowhere in the project - Studio's own DLC registry names content, not
 * storefront products, and pairing the two is what this field IS.
 */
const PARAM_APP_ID = "appId";

const CATEGORY = "Steam";

/** The value the author fills in; declared in the manifest's `contributes.buildConfig`. */
const BUILD_CONFIG_APP_ID = "appId";

/**
 * Steamworks issues App IDs as decimal numbers, and both store addresses below interpolate one
 * into a path. A value that is not a number is refused rather than pasted in: the address it
 * built would be one the manifest's patterns do not cover, and "the plugin does not declare this
 * address" is not a sentence that would tell the author their App ID field holds a URL.
 */
const APP_ID_PATTERN = /^\d+$/;

/** Reads the authored catalog. Target-specific; see the module comment. */
export type CatalogReader = () => unknown;

const execIn = { id: "in", kind: "input", semantic: "exec", label: "In" } as const;
const execNext = { id: "next", kind: "output", semantic: "exec", label: "Next" } as const;

/**
 * Optional overrides for the inspector pickers. Without them an achievement can
 * only be chosen at author time, which makes any loop — an in-game achievement
 * gallery, a "grant everything" debug menu — impossible to write.
 */
const achievementIdIn = {
    id: PIN_ACHIEVEMENT_ID,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Achievement Id",
    optional: true,
} as const;

const statIdIn = {
    id: PIN_STAT_ID,
    kind: "input",
    semantic: "data",
    valueType: "string",
    label: "Stat Id",
    optional: true,
} as const;

function achievementParam() {
    return {
        key: PARAM_ACHIEVEMENT,
        label: "Achievement",
        kind: "select" as const,
        dynamicOptionsSource: ACHIEVEMENT_OPTIONS_SOURCE,
    };
}

function statParam() {
    return {
        key: PARAM_STAT,
        label: "Stat",
        kind: "select" as const,
        dynamicOptionsSource: STAT_OPTIONS_SOURCE,
    };
}

function readString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown, fallback = 0): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    const parsed = Number.parseFloat(readString(value));
    return Number.isFinite(parsed) ? parsed : fallback;
}

/** The wired pin wins over the inspector selection, so graphs can drive these dynamically. */
function resolveAchievementId(ctx: ExecuteCtx): string {
    const id = readString(ctx.resolveInput?.(PIN_ACHIEVEMENT_ID)) || readString(ctx.params[PARAM_ACHIEVEMENT]);
    if (!id) {
        throw new Error("Pick an achievement");
    }
    return id;
}

function resolveStatId(ctx: ExecuteCtx): string {
    const id = readString(ctx.resolveInput?.(PIN_STAT_ID)) || readString(ctx.params[PARAM_STAT]);
    if (!id) {
        throw new Error("Pick a stat");
    }
    return id;
}

export function createSteamAchievementNodes(readCatalog: CatalogReader): PluginBlueprintNodeDef[] {
    const catalog = (): AchievementCatalog => normalizeCatalog(readCatalog());

    /**
     * The authored App ID, read fresh so a Dev Mode session that edits it picks
     * the new value up on reload. Only the call that opens the connection acts
     * on it; the sidecar publishes it before `SteamAPI_Init`.
     */
    const appId = (): string | null => catalog().appId ?? null;
    const status = (ctx: ExecuteCtx) => steamStatus(ctx.game, appId());
    const send = (ctx: ExecuteCtx, method: string, params?: unknown) =>
        echo(ctx.game, appId(), method, params);

    /**
     * The App ID the store address is built from: the build config first, the catalog second.
     *
     * That order is the whole reason the field exists. A demo is a separate Steam app from the game
     * it demos, and the field is scoped per variant, so the demo build states the demo's App ID and
     * the release states the release's — while the catalog holds one App ID for the entire project.
     *
     * The catalog is still read when the variant states nothing, rather than the node failing: that
     * one project-wide value is the App ID this plugin already opens the Steam connection with, so
     * it names the same app. It is also the only one that exists in Dev Mode, where `config` is
     * empty — nothing has been built for a variant there — and where the button is first tried.
     */
    const storeAppId = (ctx: ExecuteCtx): string =>
        readString(ctx.game.config.get(BUILD_CONFIG_APP_ID)) || readString(appId());

    /**
     * Write one stat: mirror first (authoritative), then echo the absolute value
     * to Steam. Absolute rather than delta on purpose — a delta would let the
     * mirror and Steam drift apart the first time an echo is dropped.
     */
    const commitStat = async (ctx: ExecuteCtx, statId: string, compute: (previous: number) => number) => {
        const stat = findStat(catalog(), statId);
        const values = await readStats(ctx.game);
        const previous = values[statId] ?? stat?.defaultValue ?? 0;
        const next = clampStatValue(stat, previous, compute(previous));
        values[statId] = next;
        await writeStats(ctx.game, values);
        await send(ctx, "stats.set", { id: statId, type: stat?.type ?? "int", value: next });
        return next;
    };

    return [
        {
            type: `${PLUGIN_ID}.unlock`,
            displayName: "Unlock Achievement",
            category: CATEGORY,
            keywords: ["steam", "achievement", "unlock", "award"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [execIn, achievementIdIn, execNext],
            inspectorParams: [achievementParam()],
            execute: async ctx => {
                const id = resolveAchievementId(ctx);
                const unlocked = await readUnlocked(ctx.game);
                unlocked.add(id);
                await writeUnlocked(ctx.game, unlocked);
                await send(ctx, "achievements.unlock", { id });
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.isUnlocked`,
            displayName: "Is Achievement Unlocked",
            category: CATEGORY,
            keywords: ["steam", "achievement", "unlocked", "has"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                achievementIdIn,
                execNext,
                { id: "unlocked", kind: "output", semantic: "data", valueType: "boolean", label: "Unlocked" },
            ],
            inspectorParams: [achievementParam()],
            // Reads the mirror, never Steam: the answer must be the same on every
            // target, and it must not depend on a child process being alive.
            execute: async ctx => ({
                nextPort: "next",
                outputValues: { unlocked: (await readUnlocked(ctx.game)).has(resolveAchievementId(ctx)) },
            }),
        },
        {
            type: `${PLUGIN_ID}.indicateProgress`,
            displayName: "Indicate Achievement Progress",
            category: CATEGORY,
            keywords: ["steam", "achievement", "progress", "toast"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                achievementIdIn,
                {
                    id: PIN_CURRENT,
                    kind: "input",
                    semantic: "data",
                    valueType: "integer",
                    label: "Current",
                    allowInlineLiteral: true,
                },
                {
                    id: PIN_MAX,
                    kind: "input",
                    semantic: "data",
                    valueType: "integer",
                    label: "Max",
                    allowInlineLiteral: true,
                    optional: true,
                },
                execNext,
            ],
            inspectorParams: [achievementParam()],
            execute: async ctx => {
                const id = resolveAchievementId(ctx);
                const authored = catalog().achievements.find(item => item.id === id)?.progress;
                const current = Math.trunc(readNumber(ctx.resolveInput?.(PIN_CURRENT)));
                const max = Math.trunc(readNumber(ctx.resolveInput?.(PIN_MAX), authored?.max ?? 0));
                // Mirrored so an in-game achievement gallery can draw the bar
                // without Steam. Steam itself only draws a transient toast.
                const progress = await readProgress(ctx.game);
                progress[id] = { current, max };
                await writeProgress(ctx.game, progress);
                if (max > 0) {
                    await send(ctx, "achievements.indicateProgress", { id, current, max });
                }
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.setStat`,
            displayName: "Set Stat",
            category: CATEGORY,
            keywords: ["steam", "stat", "set"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                statIdIn,
                {
                    id: PIN_VALUE,
                    kind: "input",
                    semantic: "data",
                    valueType: "float",
                    label: "Value",
                    allowInlineLiteral: true,
                },
                execNext,
                { id: "result", kind: "output", semantic: "data", valueType: "float", label: "Value" },
            ],
            inspectorParams: [statParam()],
            execute: async ctx => ({
                nextPort: "next",
                outputValues: {
                    result: await commitStat(ctx, resolveStatId(ctx), () => readNumber(ctx.resolveInput?.(PIN_VALUE))),
                },
            }),
        },
        {
            type: `${PLUGIN_ID}.addStat`,
            displayName: "Add Stat",
            category: CATEGORY,
            keywords: ["steam", "stat", "add", "increment"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                statIdIn,
                {
                    id: PIN_VALUE,
                    kind: "input",
                    semantic: "data",
                    valueType: "float",
                    label: "Delta",
                    allowInlineLiteral: true,
                },
                execNext,
                { id: "result", kind: "output", semantic: "data", valueType: "float", label: "Value" },
            ],
            inspectorParams: [statParam()],
            execute: async ctx => ({
                nextPort: "next",
                outputValues: {
                    result: await commitStat(
                        ctx,
                        resolveStatId(ctx),
                        previous => previous + readNumber(ctx.resolveInput?.(PIN_VALUE), 1),
                    ),
                },
            }),
        },
        {
            type: `${PLUGIN_ID}.getStat`,
            displayName: "Get Stat",
            category: CATEGORY,
            keywords: ["steam", "stat", "get", "read"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                statIdIn,
                execNext,
                { id: "result", kind: "output", semantic: "data", valueType: "float", label: "Value" },
            ],
            inspectorParams: [statParam()],
            execute: async ctx => {
                const statId = resolveStatId(ctx);
                const values = await readStats(ctx.game);
                return {
                    nextPort: "next",
                    outputValues: {
                        result: values[statId] ?? findStat(catalog(), statId)?.defaultValue ?? 0,
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.available`,
            displayName: "Steam Available",
            category: CATEGORY,
            keywords: ["steam", "available", "running", "detect"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                execNext,
                { id: "available", kind: "output", semantic: "data", valueType: "boolean", label: "Available" },
                { id: "appId", kind: "output", semantic: "data", valueType: "string", label: "App Id" },
            ],
            // False whenever the bridge is missing or SteamAPI_Init failed —
            // web, mobile, an undeclared desktop arch, or Steam simply not running.
            execute: async ctx => {
                const current = await status(ctx);
                return {
                    nextPort: "next",
                    outputValues: { available: current.available, appId: current.appId ?? "" },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.language`,
            displayName: "Steam Language",
            category: CATEGORY,
            keywords: ["steam", "language", "locale"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                execNext,
                { id: "language", kind: "output", semantic: "data", valueType: "string", label: "Language" },
            ],
            // Steam's own spelling ("english", "schinese"), not a BCP-47 tag —
            // map it in the graph rather than assuming it matches a game locale.
            execute: async ctx => ({
                nextPort: "next",
                outputValues: { language: (await status(ctx)).language ?? "" },
            }),
        },
        {
            type: `${PLUGIN_ID}.openStorePage`,
            displayName: "Open Store Page",
            category: CATEGORY,
            keywords: [
                "steam", "store", "page", "link", "open", "buy", "wishlist", "demo", "dlc",
            ],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                execNext,
                { id: "failed", kind: "output", semantic: "exec", label: "Failed" },
                { id: "error", kind: "output", semantic: "data", valueType: "string", label: "Error" },
            ],
            // Blank opens this build's own page, which is what it always did. Filled in, it opens
            // that app's - which is how a "buy the extra chapter" button reaches the DLC's page
            // rather than the game's.
            inspectorParams: [{
                key: PARAM_APP_ID,
                label: "App ID",
                kind: "string" as const,
            }],
            execute: async ctx => {
                // Every way this can go wrong leaves by `Failed` with a sentence on `Error`, and
                // none of them throws. The button that runs this is drawn in a menu the player is
                // looking at, and a store link is never worth taking the running game down for.
                const fail = (error: string) => ({ nextPort: "failed", outputValues: { error } });
                // Absent wherever nothing can hand a page over: the editor, which has no player to
                // send anywhere, and any host older than this plugin's address permission. Both are
                // reported, rather than the node dying on a method that is not there.
                const navigation = ctx.game.navigation;
                if (!navigation) {
                    return fail(
                        "Nothing here can open an address. The editor has no player to send "
                        + "anywhere, and a Studio older than this plugin's store-page permission "
                        + "has no way to ask. Try it in Dev Mode or a built game.",
                    );
                }
                const id = readString(ctx.params?.[PARAM_APP_ID]) || storeAppId(ctx);
                if (!id) {
                    return fail("No Steam App ID for this build. Fill in \"Steam App ID\" for this "
                        + "variant on the build dialog's Plugins page.");
                }
                if (!APP_ID_PATTERN.test(id)) {
                    return fail(`"${id}" is not a Steam App ID. Steamworks issues a number, such as 480.`);
                }
                const page = `https://store.steampowered.com/app/${id}`;
                // Steam being up is what makes `steam://` worth asking for: the client is there to
                // answer it, and the player stays where they were instead of being thrown into a
                // browser. It is not proof the *overlay* is on — a player can turn that off, and
                // then the client's own window shows the page, which is still the store page. So
                // the https address is what happens whenever the handler does not take the request,
                // and immediately whenever this is not a machine running Steam at all.
                if ((await status(ctx)).available) {
                    const overlay = await navigation.openExternal({ url: `steam://store/${id}` });
                    if (overlay.outcome === "opened") {
                        return { nextPort: "next", outputValues: { error: overlay.error } };
                    }
                }
                const result = await navigation.openExternal({ url: page });
                return {
                    nextPort: result.outcome === "opened" ? "next" : "failed",
                    outputValues: { error: result.error },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.ownsDlc`,
            displayName: "Owns DLC",
            category: CATEGORY,
            keywords: ["steam", "dlc", "owns", "owned", "bought", "purchased", "entitlement", "addon"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                { id: "owned", kind: "output", semantic: "exec", label: "Owned" },
                { id: "notOwned", kind: "output", semantic: "exec", label: "Not Owned" },
                { id: "isOwned", kind: "output", semantic: "data", valueType: "boolean", label: "Is Owned" },
            ],
            inspectorParams: [{
                key: PARAM_APP_ID,
                label: "DLC App ID",
                kind: "string" as const,
            }],
            /**
             * What this is for, and the one thing it must never be used for.
             *
             * FOR: deciding whether to offer the player a purchase. A menu that shows "Buy the extra
             * chapter" to somebody who already bought it is the fault this node fixes.
             *
             * NOT FOR: deciding whether the content is available. That is `Is DLC Installed` in the
             * host, and it reads the files beside the game. Steam can only be asked when it is
             * running and reachable, so a graph that gated content on this node would take an
             * offline player's bought chapter away from them.
             *
             * Which is why unavailable answers `Not Owned` rather than failing: the worst that does
             * is offer a purchase to somebody who already made one, and they land on a store page
             * that says so. The other direction would hide content.
             */
            execute: async ctx => {
                const id = readString(ctx.params?.[PARAM_APP_ID]);
                if (!APP_ID_PATTERN.test(id)) {
                    // Said once and taken as "not owned": a menu with an unfilled node draws its
                    // purchase button, which is the state the author is still working towards.
                    ctx.game.log(
                        "warning",
                        `Owns DLC has no Steam App ID${id ? ` ("${id}" is not one)` : ""}; reading as not owned.`,
                    );
                    return { nextPort: "notOwned", outputValues: { isOwned: false } };
                }
                const reply = await ask<{ owned?: boolean }>(
                    ctx.game,
                    appId(),
                    "dlc.owned",
                    { appId: Number(id) },
                );
                const owned = reply?.owned === true;
                return { nextPort: owned ? "owned" : "notOwned", outputValues: { isOwned: owned } };
            },
        },
        {
            type: `${PLUGIN_ID}.resetAll`,
            displayName: "Reset All Stats",
            category: CATEGORY,
            keywords: ["steam", "stat", "achievement", "reset", "clear", "debug"],
            graphKinds: ["event", "macro"],
            isPure: false,
            isLatent: true,
            pins: [
                execIn,
                {
                    id: PIN_ALSO_ACHIEVEMENTS,
                    kind: "input",
                    semantic: "data",
                    valueType: "boolean",
                    label: "Also Achievements",
                    allowInlineLiteral: true,
                    optional: true,
                },
                execNext,
            ],
            execute: async ctx => {
                const alsoAchievements = ctx.resolveInput?.(PIN_ALSO_ACHIEVEMENTS) === true;
                await writeStats(ctx.game, {});
                if (alsoAchievements) {
                    await writeUnlocked(ctx.game, new Set());
                    await writeProgress(ctx.game, {});
                }
                await send(ctx, "stats.resetAll", { alsoAchievements });
                return { nextPort: "next" };
            },
        },
    ];
}
