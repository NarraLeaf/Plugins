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

const CATEGORY = "Steam";

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
