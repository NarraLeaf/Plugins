/**
 * The plugin's tools for AI agents connected to Studio's MCP endpoint: what an agent building a
 * game needs to declare the Steam backend's achievements and stats without the author opening the
 * Achievements tab.
 *
 * Six tools, batch-shaped, so a chapter's worth of achievements lands in one call:
 *
 *   list                   the catalog, with every API Name an edit needs, and Studio's own checks (read)
 *   set_settings           the App ID and the languages the text is authored in (write)
 *   add_achievements       (write)
 *   update_achievements    rename, retext, hide, re-icon, bind or unbind progress (write)
 *   remove_achievements    (write)
 *   set_stats              the whole stat list (write)
 *
 * Every write tool reads the catalog, builds the next one and commits it once - one storage write -
 * so the host's capture makes each call exactly one step of undo, and the editor tab redraws from
 * the store's own notify as it does for the author's edits. Nothing is guessed: an icon resolves by
 * asset id or exact name, a progress binding by stat API Name, and anything that does not resolve
 * refuses the whole call and writes nothing.
 *
 * What these tools deliberately do **not** do is unlock anything. An achievement is unlocked by the
 * `Unlock Achievement` blueprint node while the game runs; the catalog is the declaration Steam's
 * backend is configured from. `agent/guide.md` (served as
 * `agent_guide {chapter:"plugin:narraleaf.steam-achievements"}`) has the recipe, and the list tool
 * repeats the one-line version so an agent that never reads the guide still cannot get it wrong.
 *
 * Only type imports from `narraleaf-studio/plugin`: the host supplies that module at load time
 * through an import map, so a value import here would make this file unloadable by a unit test.
 *
 * Comments in English per project convention.
 */

import type {
    Asset,
    AssetType,
    PluginAgentJsonSchema,
    PluginAgentToolDef,
    PluginAgentToolResult,
    PluginApp,
} from "narraleaf-studio/plugin";
import {
    CATALOG_VERSION,
    PLUGIN_ID,
    STEAM_API_NAME_PATTERN,
    localizedText,
    validateCatalog,
    type Achievement,
    type AchievementCatalog,
    type LocaleCode,
    type SteamStat,
    type SteamStatType,
} from "./catalog";

/** Every tool's name; `contributes.agentTools` lists the same six (a test holds them together). */
export const STEAM_AGENT_TOOLS = {
    list: `${PLUGIN_ID}.list`,
    setSettings: `${PLUGIN_ID}.set_settings`,
    addAchievements: `${PLUGIN_ID}.add_achievements`,
    updateAchievements: `${PLUGIN_ID}.update_achievements`,
    removeAchievements: `${PLUGIN_ID}.remove_achievements`,
    setStats: `${PLUGIN_ID}.set_stats`,
} as const;

/**
 * What the tools need of the editor's catalog store: the current catalog, and one call that
 * replaces it with a single storage write. The tab's store satisfies this; a test can stand in for
 * it with eight lines.
 */
export type SteamCatalogAccess = {
    get(): AchievementCatalog;
    replace(next: AchievementCatalog): Promise<void>;
};

/**
 * Said in every answer a write tool gives, and in the list tool's lead.
 *
 * An agent that has just written an achievement is one step away from assuming it also made the
 * game award it. It did not: the catalog declares what exists, the graph decides when it fires, and
 * the two live in different places.
 */
const UNLOCK_SUMMARY =
    "These tools only declare achievements; nothing here unlocks one. A game unlocks an achievement with the "
    + "Unlock Achievement blueprint node (narraleaf.steam-achievements.unlock) and drives a progress toast with "
    + "Indicate Achievement Progress. Read agent_guide {chapter:\"plugin:narraleaf.steam-achievements\"} for the recipe.";

/** The Steamworks partner site is where the catalog has to be entered as well; said once, in list. */
const BACKEND_SUMMARY =
    "Steam only knows an achievement that also exists in the Steamworks backend under the same API Name; "
    + "this catalog does not upload itself.";

/**
 * The asset type an icon points at, spelt as the host's enum value. Written out rather than read off
 * `AssetType` so this module keeps its type-only import of the plugin API.
 */
const IMAGE = "image" as AssetType;

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

const ICON_REF = "An image asset id, or its exact name as assets_list shows it. Steam wants 64x64 PNG or JPG.";

/**
 * Authored text in one or more languages.
 *
 * A bare string is the common case - a single-language project, or an agent filling the language the
 * author is working in - and lands in the catalog's first locale. The object form names the locales
 * outright. An empty string clears that language, which is how an update removes text rather than
 * leaving a blank the editor shows as authored.
 */
const LOCALIZED_TEXT: PluginAgentJsonSchema = {
    oneOf: [
        { type: "string", description: "The text, in the catalog's first language." },
        { type: "object", additionalProperties: { type: "string" }, description: "Keyed by locale code, e.g. {\"en\":\"...\",\"zh-CN\":\"...\"}. An empty string clears that language." },
    ],
};

const PROGRESS_SCHEMA: PluginAgentJsonSchema = {
    type: "object",
    description: "Turns this into a progress achievement: the \"3 of 10\" toast Indicate Achievement Progress shows.",
    properties: {
        stat: { type: "string", description: "API Name of the stat that counts it. It must already be in the catalog - set_stats first." },
        max: { type: "number", description: "The value that completes it. Above zero." },
    },
    required: ["stat", "max"],
    additionalProperties: false,
};

const ACHIEVEMENT_FIELDS: Record<string, PluginAgentJsonSchema> = {
    name: { ...LOCALIZED_TEXT, description: "Shown in the Steam overlay. Authored text, in one or more languages." },
    description: { ...LOCALIZED_TEXT, description: "The line under the name in the overlay." },
    hidden: { type: "boolean", description: "Steam shows a hidden achievement's text only once it is unlocked. For achievements that would spoil the story." },
    iconAchieved: { type: "string", description: `Icon once unlocked. ${ICON_REF}` },
    iconUnachieved: { type: "string", description: `Icon while locked. ${ICON_REF}` },
};

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

function requireList(value: unknown, what: string): Record<string, unknown>[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new SteamToolError("invalid_args", `${what} must be a non-empty array.`);
    }
    return value.map((item, index) => {
        if (!isRecord(item)) {
            throw new SteamToolError("invalid_args", `${what}[${index}] must be an object.`);
        }
        return item;
    });
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

/** `{locale: text}` or a bare string for the catalog's first language. */
function readLocalizedText(value: unknown, locales: LocaleCode[], what: string): Record<LocaleCode, string> {
    const text = readString(value);
    if (text !== undefined) {
        return { [locales[0] ?? "en"]: text };
    }
    if (!isRecord(value)) {
        throw new SteamToolError("invalid_args", `${what} must be a string or an object keyed by locale code.`);
    }
    const out: Record<LocaleCode, string> = {};
    for (const [locale, item] of Object.entries(value)) {
        const code = locale.trim();
        const line = readString(item);
        if (!code || line === undefined) {
            throw new SteamToolError("invalid_args", `${what}["${locale}"] must be a string.`);
        }
        out[code] = line;
    }
    return out;
}

/** Fold a patch into existing text: a given language is replaced, an empty string clears it. */
function mergeLocalizedText(
    existing: Record<LocaleCode, string>,
    patch: Record<LocaleCode, string>,
): Record<LocaleCode, string> {
    const out = { ...existing };
    for (const [locale, text] of Object.entries(patch)) {
        if (text.trim()) {
            out[locale] = text;
        } else {
            delete out[locale];
        }
    }
    return out;
}

function stripExtension(name: string): string {
    const trimmed = name.trim();
    const dot = trimmed.lastIndexOf(".");
    return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}

/** An image asset by id, exact name, or name without its extension (case-insensitive last). */
function resolveImage(assets: readonly Asset[], ref: string, what: string): Asset {
    const wanted = ref.trim();
    const byId = assets.find(asset => asset.id === wanted);
    if (byId) {
        return byId;
    }
    let matches = assets.filter(asset => asset.name === wanted);
    if (matches.length === 0) {
        const lower = wanted.toLowerCase();
        matches = assets.filter(asset => asset.name.toLowerCase() === lower || stripExtension(asset.name).toLowerCase() === lower);
    }
    if (matches.length === 1) {
        return matches[0]!;
    }
    if (matches.length > 1) {
        throw new SteamToolError(
            "invalid_args",
            `${what} "${wanted}" names ${matches.length} image assets (${matches.slice(0, 5).map(asset => asset.id).join(", ")}).`,
            "Pass the asset id instead.",
        );
    }
    throw new SteamToolError(
        "not_found",
        `${what}: no image asset has the id or name "${wanted}".`,
        "Call assets_list {type:\"image\"} for the names, or import the icon first.",
    );
}

// ── Describing the catalog ───────────────────────────────────────────────────────────────────────

function describeAchievement(
    achievement: Achievement,
    catalog: AchievementCatalog,
    assetName: (id: string | undefined) => string | null,
): Record<string, unknown> {
    const out: Record<string, unknown> = {
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        hidden: achievement.hidden,
    };
    if (achievement.iconAchievedAssetId) {
        out.iconAchieved = { assetId: achievement.iconAchievedAssetId, name: assetName(achievement.iconAchievedAssetId) };
    }
    if (achievement.iconUnachievedAssetId) {
        out.iconUnachieved = { assetId: achievement.iconUnachievedAssetId, name: assetName(achievement.iconUnachievedAssetId) };
    }
    if (achievement.progress) {
        out.progress = { stat: achievement.progress.statId, max: achievement.progress.max };
    }
    const display = localizedText(achievement.name, catalog.locales[0] ?? "en", catalog.locales);
    if (display) {
        out.displayName = display;
    }
    return out;
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
    const images = () => app.services.assets.list(IMAGE) as unknown as Asset[];
    const assetName = (id: string | undefined): string | null =>
        (id ? app.services.assets.get(IMAGE, id)?.name ?? null : null);

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
            "The achievements and stats this project declares: API Names, authored text per language, hidden flags, icons, "
            + "progress bindings, the Steam App ID, and the author-time problems Studio reports. Call it before any other steam "
            + "tool, for the API Names the others take. Declaring an achievement is not unlocking it - the lead line says where that happens.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Only achievements whose API Name or authored text contains this." },
            },
            additionalProperties: false,
        },
        write: false,
        handler: args => handled(async () => {
            const catalog = store.get();
            const query = readString(args.query)?.trim().toLowerCase();
            const matching = catalog.achievements.filter(achievement => !query
                || achievement.id.toLowerCase().includes(query)
                || Object.values(achievement.name).some(text => text.toLowerCase().includes(query))
                || Object.values(achievement.description).some(text => text.toLowerCase().includes(query)));
            const issues = validateCatalog(catalog);
            const result: Record<string, unknown> = {
                appId: catalog.appId ?? null,
                locales: catalog.locales,
                counts: {
                    achievements: catalog.achievements.length,
                    hidden: catalog.achievements.filter(achievement => achievement.hidden).length,
                    stats: catalog.stats.length,
                },
                achievements: matching.map(achievement => describeAchievement(achievement, catalog, assetName)),
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
                + `App ID ${catalog.appId || "not set"}, text authored in ${catalog.locales.join(", ")}.`;
            return { text: `${lead}\n${UNLOCK_SUMMARY}\n${BACKEND_SUMMARY}\n${json}`, data: result };
        }),
    };

    const setSettings: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.setSettings,
        title: "Set the App ID and languages",
        description:
            "The catalog's two project-wide values: the Steam App ID the game initializes with (a demo is a separate app from the "
            + "game, so it has its own), and the languages achievement text is authored in. Dropping a language leaves text already "
            + "written in it in place but no longer asks for it. Pass only what you are changing.",
        inputSchema: {
            type: "object",
            properties: {
                appId: { type: "string", description: "The number Steamworks gives this app, e.g. \"480\". An empty string clears it." },
                locales: { type: "array", items: { type: "string" }, description: "Locale codes, e.g. [\"en\",\"zh-CN\"]. The first is the one a bare string lands in. At least one." },
            },
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            const next: AchievementCatalog = { ...catalog };
            const changed: string[] = [];
            if (args.appId !== undefined) {
                const appId = (readString(args.appId) ?? "").trim();
                if (appId && !/^[0-9]+$/.test(appId)) {
                    throw new SteamToolError("invalid_args", `App ID "${appId}" is not a number.`, "Steamworks App IDs are digits only, e.g. 480.");
                }
                if (appId) {
                    next.appId = appId;
                } else {
                    delete next.appId;
                }
                changed.push(`App ID ${appId || "cleared"}`);
            }
            if (args.locales !== undefined) {
                if (!Array.isArray(args.locales)) {
                    throw new SteamToolError("invalid_args", "`locales` must be an array of locale codes.");
                }
                const locales: LocaleCode[] = [];
                for (const raw of args.locales) {
                    const code = (readString(raw) ?? "").trim();
                    if (!code) {
                        throw new SteamToolError("invalid_args", "`locales` entries must be non-empty locale codes.");
                    }
                    if (!locales.includes(code)) {
                        locales.push(code);
                    }
                }
                if (locales.length === 0) {
                    throw new SteamToolError("invalid_args", "`locales` must name at least one language.");
                }
                next.locales = locales;
                changed.push(`languages ${locales.join(", ")}`);
            }
            if (changed.length === 0) {
                throw new SteamToolError("invalid_args", "Nothing to change: pass `appId`, `locales`, or both.");
            }
            await commit(next);
            return answer(`Set ${changed.join(" and ")}.`);
        }),
    };

    const addAchievements: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.addAchievements,
        title: "Add Steam achievements",
        description:
            "Adds achievements to the catalog in one undo step. Each needs an `id` - the Steam API Name, which must be the same "
            + "name the Steamworks backend has - plus the text players read. `hidden` for ones that would spoil the story; "
            + "`progress` binds a counting stat so the game can show a \"3 of 10\" toast. Icons resolve by asset id or exact name; "
            + "import them first. An id that already exists, or anything that does not resolve, refuses the whole call.",
        inputSchema: {
            type: "object",
            properties: {
                achievements: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "Steam API Name: A-Z a-z 0-9 _, up to 44 characters. Conventionally ACH_SOMETHING." },
                            ...ACHIEVEMENT_FIELDS,
                            progress: PROGRESS_SCHEMA,
                        },
                        required: ["id"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["achievements"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            const assets = images();
            const added: Achievement[] = [];
            const taken = new Set(catalog.achievements.map(achievement => achievement.id));
            for (const [index, item] of requireList(args.achievements, "`achievements`").entries()) {
                const where = `achievements[${index}]`;
                const id = requireApiName(item.id, `${where}.id`);
                if (taken.has(id)) {
                    throw new SteamToolError(
                        "invalid_args",
                        `${where}: the catalog already has an achievement named "${id}".`,
                        "Use narraleaf_steam_achievements__update_achievements to change it.",
                    );
                }
                taken.add(id);
                const achievement: Achievement = {
                    id,
                    name: item.name === undefined ? {} : readLocalizedText(item.name, catalog.locales, `${where}.name`),
                    description: item.description === undefined ? {} : readLocalizedText(item.description, catalog.locales, `${where}.description`),
                    hidden: item.hidden === true,
                };
                const achieved = readString(item.iconAchieved)?.trim();
                if (achieved) {
                    achievement.iconAchievedAssetId = resolveImage(assets, achieved, `${where}.iconAchieved`).id;
                }
                const unachieved = readString(item.iconUnachieved)?.trim();
                if (unachieved) {
                    achievement.iconUnachievedAssetId = resolveImage(assets, unachieved, `${where}.iconUnachieved`).id;
                }
                if (item.progress !== undefined) {
                    achievement.progress = readProgress(item.progress, catalog, `${where}.progress`);
                }
                added.push(achievement);
            }
            const next: AchievementCatalog = { ...catalog, achievements: [...catalog.achievements, ...added] };
            refuseOnErrors(next, "Adding these achievements");
            await commit(next);
            return answer(
                `Added ${added.length} achievement${added.length === 1 ? "" : "s"}: ${added.map(achievement => achievement.id).join(", ")}.`,
                { added: added.map(achievement => achievement.id) },
            );
        }),
    };

    const updateAchievements: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.updateAchievements,
        title: "Update Steam achievements",
        description:
            "Changes achievements already in the catalog, in one undo step. Pass only the fields you are changing: text is folded "
            + "in per language (an empty string clears that language), `progress: null` unbinds a counting stat, and `newId` renames "
            + "the API Name - which has to be renamed in the Steamworks backend too, or Steam will not know it. An id that is not in "
            + "the catalog, or anything that does not resolve, refuses the whole call.",
        inputSchema: {
            type: "object",
            properties: {
                achievements: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "The achievement's current API Name." },
                            newId: { type: "string", description: "Rename it to this. Rename it in the Steamworks backend as well." },
                            ...ACHIEVEMENT_FIELDS,
                            progress: { oneOf: [PROGRESS_SCHEMA, { type: "null" }], description: "Bind a counting stat, or null to unbind." },
                        },
                        required: ["id"],
                        additionalProperties: false,
                    },
                },
            },
            required: ["achievements"],
            additionalProperties: false,
        },
        write: true,
        handler: args => handled(async () => {
            const catalog = store.get();
            const assets = images();
            let achievements = [...catalog.achievements];
            const touched: string[] = [];
            const renamed: string[] = [];
            for (const [index, item] of requireList(args.achievements, "`achievements`").entries()) {
                const where = `achievements[${index}]`;
                const id = (readString(item.id) ?? "").trim();
                const at = achievements.findIndex(achievement => achievement.id === id);
                if (at < 0) {
                    throw new SteamToolError(
                        "not_found",
                        `${where}: no achievement in the catalog is named "${id}".`,
                        "Call narraleaf_steam_achievements__list for the API Names.",
                    );
                }
                const current = achievements[at]!;
                const updated: Achievement = { ...current };
                if (item.newId !== undefined) {
                    const newId = requireApiName(item.newId, `${where}.newId`);
                    if (newId !== id && achievements.some(achievement => achievement.id === newId)) {
                        throw new SteamToolError("invalid_args", `${where}.newId: the catalog already has an achievement named "${newId}".`);
                    }
                    updated.id = newId;
                    if (newId !== id) {
                        renamed.push(`${id} to ${newId}`);
                    }
                }
                if (item.name !== undefined) {
                    updated.name = mergeLocalizedText(current.name, readLocalizedText(item.name, catalog.locales, `${where}.name`));
                }
                if (item.description !== undefined) {
                    updated.description = mergeLocalizedText(current.description, readLocalizedText(item.description, catalog.locales, `${where}.description`));
                }
                if (item.hidden !== undefined) {
                    if (typeof item.hidden !== "boolean") {
                        throw new SteamToolError("invalid_args", `${where}.hidden must be true or false.`);
                    }
                    updated.hidden = item.hidden;
                }
                for (const [key, field] of [["iconAchieved", "iconAchievedAssetId"], ["iconUnachieved", "iconUnachievedAssetId"]] as const) {
                    if (item[key] === undefined) {
                        continue;
                    }
                    const ref = (readString(item[key]) ?? "").trim();
                    if (ref) {
                        updated[field] = resolveImage(assets, ref, `${where}.${key}`).id;
                    } else {
                        delete updated[field];
                    }
                }
                if (item.progress !== undefined) {
                    if (item.progress === null) {
                        delete updated.progress;
                    } else {
                        updated.progress = readProgress(item.progress, catalog, `${where}.progress`);
                    }
                }
                achievements = achievements.map((achievement, position) => (position === at ? updated : achievement));
                touched.push(updated.id);
            }
            const next: AchievementCatalog = { ...catalog, achievements };
            refuseOnErrors(next, "Updating these achievements");
            await commit(next);
            const rename = renamed.length > 0
                ? ` Renamed ${renamed.join(", ")} - rename ${renamed.length === 1 ? "it" : "them"} in the Steamworks backend too, or Steam will not recognize the call.`
                : "";
            return answer(`Updated ${touched.length} achievement${touched.length === 1 ? "" : "s"}: ${touched.join(", ")}.${rename}`, { updated: touched });
        }),
    };

    const removeAchievements: PluginAgentToolDef = {
        name: STEAM_AGENT_TOOLS.removeAchievements,
        title: "Remove Steam achievements",
        description:
            "Removes achievements from the catalog in one undo step. This does not touch the Steamworks backend, and does not touch "
            + "blueprint graphs: an Unlock Achievement node still naming a removed achievement will try to unlock a name the catalog "
            + "no longer has. An id that is not in the catalog refuses the whole call.",
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
            "Replaces the whole stat list in one undo step - call list first and send back the stats you are keeping, or the ones you "
            + "leave out are gone. A stat is a number Steam keeps per player: what a progress achievement counts, and what Set Stat, "
            + "Add To Stat and Get Stat read and write. Dropping a stat a progress achievement is bound to refuses the call.",
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
                if (raw.incrementOnly === true) {
                    stat.incrementOnly = true;
                }
                stats.push(stat);
            }
            const bound = catalog.achievements
                .filter(achievement => achievement.progress && !stats.some(stat => stat.id === achievement.progress!.statId))
                .map(achievement => `${achievement.id} needs ${achievement.progress!.statId}`);
            if (bound.length > 0) {
                throw new SteamToolError(
                    "invalid_args",
                    `This list drops stats that progress achievements are bound to: ${bound.join("; ")}.`,
                    "Keep those stats, or unbind the achievements first with update_achievements {progress: null}.",
                );
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

    return [list, setSettings, addAchievements, updateAchievements, removeAchievements, setStats];
}

/** A progress binding, with the stat resolved against the catalog rather than taken on trust. */
function readProgress(value: unknown, catalog: AchievementCatalog, where: string): { statId: string; max: number } {
    if (!isRecord(value)) {
        throw new SteamToolError("invalid_args", `${where} must be an object with \`stat\` and \`max\`.`);
    }
    const statId = (readString(value.stat) ?? "").trim();
    if (!statId) {
        throw new SteamToolError("invalid_args", `${where}.stat is required.`);
    }
    if (!catalog.stats.some(stat => stat.id === statId)) {
        throw new SteamToolError(
            "not_found",
            `${where}.stat: no stat in the catalog is named "${statId}".`,
            "Declare it with narraleaf_steam_achievements__set_stats first; a progress toast counts a stat.",
        );
    }
    const max = readNumber(value.max);
    if (max === undefined || !(max > 0)) {
        throw new SteamToolError("invalid_args", `${where}.max must be a number above zero.`);
    }
    return { statId, max };
}
