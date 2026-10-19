/**
 * The plugin's tools for AI agents connected to Studio's MCP endpoint: what an agent building a
 * game needs to declare the API Names Steam will be asked about, without the author opening the
 * Achievements panel.
 *
 * Six tools, batch-shaped, so a chapter's worth of achievements lands in one call:
 *
 *   list                   the catalog, and the author-time problems Studio reports (read)
 *   set_app_id             the Steam App ID the game initializes with (write)
 *   add_achievements       (write)
 *   rename_achievements    (write)
 *   remove_achievements    (write)
 *   set_stats              the whole stat list (write)
 *
 * The catalog is deliberately thin, and these tools are thin with it. An achievement is an API
 * Name and nothing else: the name, description, icons and hidden flag a player reads live on the
 * Steamworks partner site, and Steam draws them from there. Version 0.1 asked for all of that here
 * too and none of it ever reached Steam, so there is nothing here to write it with — an agent that
 * wants to set achievement text has to tell the author to do it on the partner site. Fields a 0.1
 * catalog carries are passed through untouched rather than dropped.
 *
 * Every write tool reads the catalog, builds the next one and commits it once — one storage write —
 * so the host's capture makes each call exactly one step of undo, and the panel redraws from the
 * store's own notify as it does for the author's edits. Anything that does not resolve refuses the
 * whole call and writes nothing.
 *
 * What these tools deliberately do **not** do is unlock anything. An achievement is unlocked while
 * the game runs, by a story row (`/unlock ACH_NAME`) or the `Unlock Achievement` blueprint node;
 * the catalog is only the declaration. `agent/guide.md` (served as
 * `agent_guide {chapter:"plugin:narraleaf.steam-achievements"}`) has the recipe, and every answer
 * repeats the one-line version so an agent that never reads the guide still cannot get it wrong.
 *
 * Only type imports from `narraleaf-studio/plugin`: the host supplies that module at load time
 * through an import map, so a value import here would make this file unloadable by a unit test.
 *
 * Comments in English per project convention.
 */

import type {
    PluginAgentJsonSchema,
    PluginAgentToolDef,
    PluginAgentToolResult,
    PluginApp,
} from "narraleaf-studio/plugin";
import {
    CATALOG_VERSION,
    PLUGIN_ID,
    STEAM_API_NAME_PATTERN,
    validateCatalog,
    type Achievement,
    type AchievementCatalog,
    type SteamStat,
    type SteamStatType,
} from "./catalog";

/** Every tool's name; `contributes.agentTools` lists the same six (a test holds them together). */
export const STEAM_AGENT_TOOLS = {
    list: `${PLUGIN_ID}.list`,
    setAppId: `${PLUGIN_ID}.set_app_id`,
    addAchievements: `${PLUGIN_ID}.add_achievements`,
    renameAchievements: `${PLUGIN_ID}.rename_achievements`,
    removeAchievements: `${PLUGIN_ID}.remove_achievements`,
    setStats: `${PLUGIN_ID}.set_stats`,
} as const;

/**
 * What the tools need of the editor's catalog store: the current catalog, and one call that
 * replaces it with a single storage write. The panel's store satisfies this; a test can stand in
 * for it with eight lines.
 */
export type SteamCatalogAccess = {
    get(): AchievementCatalog;
    replace(next: AchievementCatalog): Promise<void>;
};

/**
 * Said in every answer.
 *
 * An agent that has just declared an achievement is one step away from assuming it also made the
 * game award it. It did not: the catalog declares what exists, the story row or the graph decides
 * when it fires, and the two live in different places.
 */
const UNLOCK_SUMMARY =
    "These tools only declare API Names; nothing here unlocks an achievement. A game unlocks one from a story "
    + "row (/unlock ACH_NAME) or with the Unlock Achievement blueprint node, and drives stats with Set Stat and "
    + "Add To Stat. Read agent_guide {chapter:\"plugin:narraleaf.steam-achievements\"} for the recipe.";

/**
 * The part no tool can do for the author, said once in list rather than in every answer.
 *
 * Everything a player reads — the achievement's name, its description, its icons, whether it is
 * hidden until unlocked — is entered on the partner site, not here.
 */
const BACKEND_SUMMARY =
    "Steam only knows an achievement that also exists in the Steamworks backend under the same API Name, and the "
    + "name, description, icons and hidden flag players see are set there, not in this catalog. Tell the author to "
    + "enter them at partner.steamgames.com; nothing in Studio can.";

/** A call the agent can correct; turned into a refusal by {@link handled}. */
class SteamToolError extends Error {
    constructor(
        public readonly code: "invalid_args" | "not_found" | "unavailable",
        message: string,
        public readonly hint?: string,
    ) {
        super(message);
    }
}

// ── Schemas ──────────────────────────────────────────────────────────────────────────────────────

const STAT_SCHEMA: PluginAgentJsonSchema = {
    type: "object",
    description: "One Steam stat: a number the backend keeps per player.",
    properties: {
        id: { type: "string", description: "API Name: A-Z a-z 0-9 _, up to 44 characters. The same name must exist in the Steamworks backend." },
        type: { type: "string", enum: ["int", "float"], description: "Steam's average-rate kind is deliberately absent: no node has a session length to give it, so it could never reach Steam. Defaults to int." },
        defaultValue: { type: "number", description: "What a new player starts at. Defaults to 0." },
        min: { type: "number", description: "Writes below this are clamped." },
        max: { type: "number", description: "Writes above this are clamped." },
        incrementOnly: { type: "boolean", description: "Refuse writes that would lower the value. Steam has the same flag server-side; set both." },
    },
    required: ["id"],
    additionalProperties: false,
};

// ── Reading arguments ────────────────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** An API Name, checked here rather than left for Steam to truncate months later. */
function requireApiName(value: unknown, what: string): string {
    const id = (readString(value) ?? "").trim();
    if (!id) {
        throw new SteamToolError("invalid_args", `${what} is required.`);
    }
    if (!STEAM_API_NAME_PATTERN.test(id)) {
        throw new SteamToolError(
            "invalid_args",
            `${what} "${id}" is not a Steam API Name: A-Z a-z 0-9 and _ only, 1 to 44 characters.`,
            "Steam silently truncates or rejects anything else, and the failure shows up as an achievement that never fires.",
        );
    }
    return id;
}

/** A non-empty array of strings, each an API Name. */
function requireApiNames(value: unknown, what: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new SteamToolError("invalid_args", `${what} must be a non-empty array of API Names.`);
    }
    return value.map((item, index) => requireApiName(item, `${what}[${index}]`));
}

// ── Describing the catalog ───────────────────────────────────────────────────────────────────────

/**
 * One achievement as the agent sees it: its API Name, plus a note when the entry still carries
 * fields a 0.1 catalog wrote. Those are the author's own words and are passed through every edit,
 * but nothing reads them any more, so naming them is more honest than printing them.
 */
function describeAchievement(achievement: Achievement): Record<string, unknown> {
    const carried = Object.keys(achievement).filter(key => key !== "id");
    return carried.length > 0 ? { id: achievement.id, carriedFields: carried } : { id: achievement.id };
}

function describeStat(stat: SteamStat): Record<string, unknown> {
    const out: Record<string, unknown> = { id: stat.id, type: stat.type, defaultValue: stat.defaultValue };
    if (stat.min !== undefined) {
        out.min = stat.min;
    }
    if (stat.max !== undefined) {
        out.max = stat.max;
    }
    if (stat.incrementOnly) {
        out.incrementOnly = true;
    }
    return out;
}

// ── Tools ────────────────────────────────────────────────────────────────────────────────────────

/** Run a handler, turning a {@link SteamToolError} into a refusal the agent reads. */
async function handled(run: () => Promise<PluginAgentToolResult>): Promise<PluginAgentToolResult> {
    try {
        return await run();
    } catch (error) {
        if (error instanceof SteamToolError) {
            return { error: { code: error.code, message: error.message, ...(error.hint ? { hint: error.hint } : {}) } };
        }
        throw error;
    }
}

export function createSteamAgentTools(app: PluginApp, store: SteamCatalogAccess): PluginAgentToolDef[] {
    const commit = async (next: AchievementCatalog) => {
        // The store drops a write on a frozen project, which for the author is the right silence and
        // for an agent is the wrong one: it would read the call as done and carry on.
        if (app.services.workspace.frozen) {
            throw new SteamToolError(
                "unavailable",
                "The project is not accepting changes right now.",
                "Wait until the author's operation finishes, then try again.",
            );
        }
        await store.replace({ ...next, version: CATALOG_VERSION });
    };

    /** Problems worth refusing over, checked on the catalog the call would commit. */
    const refuseOnErrors = (next: AchievementCatalog, what: string) => {
        const errors = validateCatalog(next).filter(issue => issue.severity === "error");
        if (errors.length > 0) {
            throw new SteamToolError(
                "invalid_args",
                `${what} would leave the catalog invalid: ${errors.map(issue => (issue.subjectId ? `${issue.subjectId}: ${issue.message}` : issue.message)).join("; ")}`,
                "Nothing was written. Fix the call and send it again.",
            );
        }
    };

    const answer = (text: string, data?: Record<string, unknown>): PluginAgentToolResult =>
        ({ text: `${text}\n${UNLOCK_SUMMARY}`, ...(data ? { data } : {}) });

    const list: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.list,
        title: "Read the Steam achievement catalog",
        description:
            "The API Names this project declares — achievements and stats — the Steam App ID, and the author-time "
            + "problems Studio reports. Call it before any other steam tool, for the names the others take. The catalog "
            + "holds names only: everything a player reads about an achievement is set in the Steamworks backend, and "
            + "declaring one is not unlocking it. The lead lines say where both of those happen.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Only achievements whose API Name contains this." },
            },
            additionalProperties: false,
        },
        write: false,
        handler: args => handled(async () => {
            const catalog = store.get();
            const query = readString(args.query)?.trim().toLowerCase();
            const matching = catalog.achievements.filter(achievement => !query || achievement.id.toLowerCase().includes(query));
            const issues = validateCatalog(catalog);
            const result: Record<string, unknown> = {
                appId: catalog.appId ?? null,
                counts: { achievements: catalog.achievements.length, stats: catalog.stats.length },
                achievements: matching.map(describeAchievement),
                stats: catalog.stats.map(describeStat),
                problems: issues.map(issue => ({ severity: issue.severity, subject: issue.subjectId ?? null, message: issue.message })),
            };
            let json = JSON.stringify(result);
            if (json.length > 55_000) {
                const kept = Math.max(1, Math.floor(matching.length * 55_000 / json.length));
                result.achievements = (result.achievements as unknown[]).slice(0, kept);
                result.truncated = `Showing ${kept} of ${matching.length} achievements; pass \`query\` for the rest.`;
                json = JSON.stringify(result);
            }
            const lead = `Steam catalog: ${catalog.achievements.length} achievements, ${catalog.stats.length} stats, `
                + `App ID ${catalog.appId || "not set"}.`;
            return { text: `${lead}\n${UNLOCK_SUMMARY}\n${BACKEND_SUMMARY}\n${json}`, data: result };
        }),
    };

    const setAppId: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.setAppId,
        title: "Set the Steam App ID",
        description:
            "The App ID the game initializes Steam with — the author never places a steam_appid.txt anywhere. It is "
            + "read once, when the game first reaches Steam, so a change takes effect on the next run. A demo is a "
            + "separate Steam app from the game it demos; that per-build value is a build setting the author fills in, "
            + "not something this tool can reach.",
        inputSchema: {
            type: "object",
            properties: {
                appId: { type: "string", description: "The number Steamworks gives this app, e.g. \"480\". An empty string clears it." },
            },
            required: ["appId"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const appId = (readString(args.appId) ?? "").trim();
            if (appId && !/^[0-9]+$/.test(appId)) {
                throw new SteamToolError("invalid_args", `App ID "${appId}" is not a number.`, "Steamworks App IDs are digits only, e.g. 480.");
            }
            const catalog = store.get();
            const next: AchievementCatalog = { ...catalog };
            if (appId) {
                next.appId = appId;
            } else {
                delete next.appId;
            }
            await commit(next);
            return answer(appId ? `Set the Steam App ID to ${appId}.` : "Cleared the Steam App ID.");
        }),
    };

    const addAchievements: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.addAchievements,
        title: "Add Steam achievements",
        description:
            "Declares achievements in one undo step, by API Name — conventionally ACH_SOMETHING. That is all an entry "
            + "holds: what players read is entered in the Steamworks backend under the same name, which the author has "
            + "to do and no tool here can. A name Steam would reject, or one the catalog already has, refuses the whole "
            + "call. Once declared, a name can be unlocked from a story row or a blueprint graph.",
        inputSchema: {
            type: "object",
            properties: {
                ids: { type: "array", items: { type: "string" }, description: "API Names to declare: A-Z a-z 0-9 _, up to 44 characters each." },
            },
            required: ["ids"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            const taken = new Set(catalog.achievements.map(achievement => achievement.id));
            const added: Achievement[] = [];
            for (const [index, id] of requireApiNames(args.ids, "`ids`").entries()) {
                if (taken.has(id)) {
                    throw new SteamToolError(
                        "invalid_args",
                        `ids[${index}]: the catalog already has an achievement named "${id}".`,
                        "Names are case-sensitive to Steam; call narraleaf_steam_achievements__list for the ones already declared.",
                    );
                }
                taken.add(id);
                added.push({ id });
            }
            const next: AchievementCatalog = { ...catalog, achievements: [...catalog.achievements, ...added] };
            refuseOnErrors(next, "Adding these achievements");
            await commit(next);
            return answer(
                `Declared ${added.length} achievement${added.length === 1 ? "" : "s"}: ${added.map(achievement => achievement.id).join(", ")}. `
                + "Enter the same names in the Steamworks backend, with the text and icons players see.",
                { added: added.map(achievement => achievement.id) },
            );
        }),
    };

    const renameAchievements: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.renameAchievements,
        title: "Rename Steam achievements",
        description:
            "Changes achievements' API Names in one undo step. The name has to be renamed in the Steamworks backend too, "
            + "or Steam will not recognize the call — and any story row or blueprint node naming the old one goes on "
            + "naming it, so fix those as well. Fields a 0.1 catalog carried on the entry are kept. A name the catalog "
            + "does not have, or a new name it already has, refuses the whole call.",
        inputSchema: {
            type: "object",
            properties: {
                renames: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "The achievement's current API Name." },
                            newId: { type: "string", description: "What to call it instead." },
                        },
                        required: ["id", "newId"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["renames"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            if (!Array.isArray(args.renames) || args.renames.length === 0) {
                throw new SteamToolError("invalid_args", "`renames` must be a non-empty array of {id, newId}.");
            }
            let achievements = [...catalog.achievements];
            const done: string[] = [];
            for (const [index, raw] of args.renames.entries()) {
                if (!isRecord(raw)) {
                    throw new SteamToolError("invalid_args", `renames[${index}] must be an object with \`id\` and \`newId\`.`);
                }
                const where = `renames[${index}]`;
                const id = (readString(raw.id) ?? "").trim();
                const at = achievements.findIndex(achievement => achievement.id === id);
                if (at < 0) {
                    throw new SteamToolError(
                        "not_found",
                        `${where}.id: no achievement in the catalog is named "${id}".`,
                        "Call narraleaf_steam_achievements__list for the API Names.",
                    );
                }
                const newId = requireApiName(raw.newId, `${where}.newId`);
                if (newId !== id && achievements.some(achievement => achievement.id === newId)) {
                    throw new SteamToolError("invalid_args", `${where}.newId: the catalog already has an achievement named "${newId}".`);
                }
                achievements = achievements.map((achievement, position) => (position === at ? { ...achievement, id: newId } : achievement));
                done.push(`${id} to ${newId}`);
            }
            const next: AchievementCatalog = { ...catalog, achievements };
            refuseOnErrors(next, "Renaming these achievements");
            await commit(next);
            return answer(
                `Renamed ${done.length} achievement${done.length === 1 ? "" : "s"}: ${done.join(", ")}. `
                + `Rename ${done.length === 1 ? "it" : "them"} in the Steamworks backend too, and update any story row or node that names the old one.`,
                { renamed: done },
            );
        }),
    };

    const removeAchievements: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.removeAchievements,
        title: "Remove Steam achievements",
        description:
            "Undeclares achievements in one undo step. This touches neither the Steamworks backend nor the project's "
            + "story rows and blueprint graphs: a /unlock row or an Unlock Achievement node naming a removed name goes "
            + "on naming it, and the row's inspector then lists it as missing. A name the catalog does not have refuses "
            + "the whole call.",
        inputSchema: {
            type: "object",
            properties: {
                ids: { type: "array", items: { type: "string" }, description: "API Names to remove." },
            },
            required: ["ids"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            if (!Array.isArray(args.ids) || args.ids.length === 0) {
                throw new SteamToolError("invalid_args", "`ids` must be a non-empty array of API Names.");
            }
            const removing: string[] = [];
            for (const [index, raw] of args.ids.entries()) {
                const id = (readString(raw) ?? "").trim();
                if (!catalog.achievements.some(achievement => achievement.id === id)) {
                    throw new SteamToolError(
                        "not_found",
                        `ids[${index}]: no achievement in the catalog is named "${id}".`,
                        "Call narraleaf_steam_achievements__list for the API Names.",
                    );
                }
                if (!removing.includes(id)) {
                    removing.push(id);
                }
            }
            const next: AchievementCatalog = {
                ...catalog,
                achievements: catalog.achievements.filter(achievement => !removing.includes(achievement.id)),
            };
            await commit(next);
            return answer(`Removed ${removing.length} achievement${removing.length === 1 ? "" : "s"}: ${removing.join(", ")}.`, { removed: removing });
        }),
    };

    const setStats: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.setStats,
        title: "Set the Steam stats",
        description:
            "Replaces the whole stat list in one undo step — call list first and send back the stats you are keeping, or "
            + "the ones you leave out are gone. A stat is a number Steam keeps per player: what Set Stat, Add To Stat and "
            + "Get Stat read and write, and what a progress achievement counts in the Steamworks backend. Clamping "
            + "(min, max, incrementOnly) is enforced on every write the game makes.",
        inputSchema: {
            type: "object",
            properties: {
                stats: { type: "array", items: STAT_SCHEMA, description: "The complete list. An empty array removes every stat." },
            },
            required: ["stats"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            if (!Array.isArray(args.stats)) {
                throw new SteamToolError("invalid_args", "`stats` must be an array (empty to remove every stat).");
            }
            const stats: SteamStat[] = [];
            for (const [index, raw] of args.stats.entries()) {
                if (!isRecord(raw)) {
                    throw new SteamToolError("invalid_args", `stats[${index}] must be an object.`);
                }
                const where = `stats[${index}]`;
                const id = requireApiName(raw.id, `${where}.id`);
                if (stats.some(stat => stat.id === id)) {
                    throw new SteamToolError("invalid_args", `${where}: "${id}" is listed twice.`);
                }
                const type: SteamStatType = raw.type === "float" ? "float" : "int";
                const stat: SteamStat = { id, type, defaultValue: readNumber(raw.defaultValue) ?? 0 };
                const min = readNumber(raw.min);
                const max = readNumber(raw.max);
                if (min !== undefined) {
                    stat.min = min;
                }
                if (max !== undefined) {
                    stat.max = max;
                }
                if (min !== undefined && max !== undefined && min > max) {
                    throw new SteamToolError("invalid_args", `${where}: min ${min} is above max ${max}.`);
                }
                if (raw.incrementOnly === true) {
                    stat.incrementOnly = true;
                }
                stats.push(stat);
            }
            const next: AchievementCatalog = { ...catalog, stats };
            refuseOnErrors(next, "Setting these stats");
            await commit(next);
            return answer(
                stats.length === 0
                    ? "Removed every stat."
                    : `Set ${stats.length} stat${stats.length === 1 ? "" : "s"}: ${stats.map(stat => `${stat.id} (${stat.type})`).join(", ")}.`,
                { stats: stats.map(stat => stat.id) },
            );
        }),
    };

    return [list, setAppId, addAchievements, renameAchievements, removeAchievements, setStats];
}
