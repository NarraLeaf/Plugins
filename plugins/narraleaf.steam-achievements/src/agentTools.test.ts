/**
 * The agent tools against a stand-in for Studio: that each write tool resolves what the agent
 * names, refuses the whole call when anything does not resolve, and commits exactly once — which is
 * what makes one call one step of undo once the host captures it.
 *
 * The schema case is the one that would otherwise only fail at load, inside Studio: a name the
 * manifest does not declare, a write flag that disagrees with it, or an input schema the host
 * refuses are all registration-time errors, and none of them is visible from this package.
 */

import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import type { PluginAgentToolDef, PluginApp } from "narraleaf-studio/plugin";
import { STEAM_AGENT_TOOLS, createSteamAgentTools, type SteamCatalogAccess } from "./agentTools";
import { CATALOG_VERSION, emptyCatalog, normalizeCatalog, type AchievementCatalog } from "./catalog";

const PLUGIN_ID = "narraleaf.steam-achievements";

const IMAGES = [
    { id: "img-win", name: "ach_win.png", type: "image" },
    { id: "img-locked", name: "ach_locked.png", type: "image" },
    { id: "img-dup-a", name: "same.png", type: "image" },
    { id: "img-dup-b", name: "same.png", type: "image" },
];

function setup(initial?: Partial<AchievementCatalog>, { frozen = false } = {}) {
    let catalog = normalizeCatalog({ ...emptyCatalog(), ...initial });
    const writes: AchievementCatalog[] = [];
    const store: SteamCatalogAccess = {
        get: () => catalog,
        replace: async next => {
            catalog = normalizeCatalog(next);
            writes.push(catalog);
        },
    };
    const app = {
        services: {
            workspace: { frozen },
            assets: {
                list: () => IMAGES,
                get: (_type: unknown, id: string) => IMAGES.find(asset => asset.id === id),
            },
        },
    } as unknown as PluginApp;
    const tools = new Map(createSteamAgentTools(app, store).map(tool => [tool.name, tool]));
    const call = (name: string, args: Record<string, unknown>) =>
        (tools.get(name) as PluginAgentToolDef).handler(args, { clientName: null });
    return { call, tools, writes, current: () => catalog };
}

/** What a result says when it refused; null when it answered. */
function refusal(result: unknown): { code?: string; message: string; hint?: string } | null {
    return typeof result === "object" && result !== null && "error" in result
        ? (result as { error: { code?: string; message: string; hint?: string } }).error
        : null;
}

function text(result: unknown): string {
    return typeof result === "object" && result !== null && "text" in result ? String((result as { text: string }).text) : "";
}

/**
 * Port of the host's own input-schema check (`checkAgentPluginToolSchema`): the key set it accepts,
 * the types, the depth, and the one argument a plugin may not declare because Studio adds it.
 */
const SCHEMA_KEYS = new Set([
    "type", "description", "properties", "required", "items", "enum",
    "additionalProperties", "minimum", "maximum", "default", "oneOf",
]);
const SCHEMA_TYPES = new Set(["object", "string", "number", "integer", "boolean", "array", "null"]);

function checkSchema(node: unknown, path: string, depth: number, errors: string[]): void {
    if (depth > 10) {
        errors.push(`${path}: deeper than 10 levels`);
        return;
    }
    if (typeof node !== "object" || node === null || Array.isArray(node)) {
        errors.push(`${path}: must be a schema object`);
        return;
    }
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (!SCHEMA_KEYS.has(key)) {
            errors.push(`${path}: \`${key}\` is not supported`);
        }
    }
    if (record.type !== undefined && (typeof record.type !== "string" || !SCHEMA_TYPES.has(record.type))) {
        errors.push(`${path}.type: ${String(record.type)}`);
    }
    if (record.properties !== undefined) {
        for (const [name, child] of Object.entries(record.properties as Record<string, unknown>)) {
            checkSchema(child, `${path}.properties.${name}`, depth + 1, errors);
        }
    }
    if (record.items !== undefined) {
        checkSchema(record.items, `${path}.items`, depth + 1, errors);
    }
    if (Array.isArray(record.oneOf)) {
        record.oneOf.forEach((option, index) => checkSchema(option, `${path}.oneOf[${index}]`, depth + 1, errors));
    }
    if (typeof record.additionalProperties === "object" && record.additionalProperties !== null) {
        checkSchema(record.additionalProperties, `${path}.additionalProperties`, depth + 1, errors);
    }
    if (Array.isArray(record.required) && typeof record.properties === "object" && record.properties !== null) {
        for (const name of record.required as string[]) {
            if (!(name in (record.properties as Record<string, unknown>))) {
                errors.push(`${path}.required: \`${name}\` is not in properties`);
            }
        }
    }
}

/** Port of the host's `agentPluginToolMcpName`. */
function mcpName(name: string): string {
    const local = name.slice(PLUGIN_ID.length + 1);
    return `${PLUGIN_ID.replace(/[.-]/g, "_")}__${local.replace(/[.-]/g, "_")}`;
}

describe("the Steam plugin's agent tools", () => {
    it("are the six the manifest declares, with the same write flags and schemas Studio accepts", () => {
        const { tools } = setup();
        const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")) as {
            contributes: { agentTools: { name: string; write: boolean }[]; agentGuide: string };
        };
        const declared = manifest.contributes.agentTools;
        expect([...tools.values()].map(tool => ({ name: tool.name, write: tool.write }))).toEqual(declared);
        expect(declared.map(tool => tool.name)).toEqual(Object.values(STEAM_AGENT_TOOLS));
        expect(manifest.contributes.agentGuide).toBe("agent/guide.md");
        for (const tool of tools.values()) {
            const errors: string[] = [];
            checkSchema(tool.inputSchema, tool.name, 0, errors);
            expect(errors, tool.name).toEqual([]);
            expect((tool.inputSchema.properties ?? {}).project, tool.name).toBeUndefined();
            expect(mcpName(tool.name).length, tool.name).toBeLessThanOrEqual(64);
            expect(mcpName(tool.name), tool.name).toMatch(/^narraleaf_steam_achievements__[a-z_]+$/);
            expect(tool.title.length, tool.name).toBeLessThanOrEqual(80);
            expect(tool.description.length, tool.name).toBeLessThanOrEqual(1200);
        }
        // Only `list` reads; every other tool changes the project and must say so, or the author is
        // shown a reading tool and the host never gates it.
        expect([...tools.values()].filter(tool => !tool.write).map(tool => tool.name)).toEqual([STEAM_AGENT_TOOLS.list]);
    });

    it("say where unlocking actually happens, in every answer", async () => {
        const { call } = setup();
        const list = await call(STEAM_AGENT_TOOLS.list, {});
        const write = await call(STEAM_AGENT_TOOLS.setSettings, { appId: "480" });
        for (const result of [list, write]) {
            expect(text(result)).toContain("Unlock Achievement blueprint node");
        }
        expect(text(list)).toContain("Steamworks backend");
    });

    it("add achievements in one write, resolving icons by name and by id", async () => {
        const { call, writes, current } = setup({ stats: [{ id: "EndingsSeen", type: "int", defaultValue: 0 }] });
        const result = await call(STEAM_AGENT_TOOLS.addAchievements, {
            achievements: [
                { id: "ACH_FIRST", name: "First words", description: { en: "You said it." }, iconAchieved: "ach_win", iconUnachieved: "img-locked" },
                { id: "ACH_ALL", name: { en: "Completionist" }, hidden: true, progress: { stat: "EndingsSeen", max: 4 } },
            ],
        });
        expect(text(result)).toContain("Added 2 achievements");
        expect(writes).toHaveLength(1);
        const [first, all] = current().achievements;
        expect(first).toMatchObject({
            id: "ACH_FIRST",
            name: { en: "First words" },
            description: { en: "You said it." },
            hidden: false,
            iconAchievedAssetId: "img-win",
            iconUnachievedAssetId: "img-locked",
        });
        expect(all).toMatchObject({ id: "ACH_ALL", hidden: true, progress: { statId: "EndingsSeen", max: 4 } });
        expect(current().version).toBe(CATALOG_VERSION);
    });

    it("refuse the whole call, writing nothing, when one achievement is wrong", async () => {
        const cases: [string, Record<string, unknown>, string][] = [
            ["a name Steam would reject", { achievements: [{ id: "ACH_FRESH" }, { id: "no spaces here" }] }, "not a Steam API Name"],
            ["an id already in the catalog", { achievements: [{ id: "ACH_OK" }] }, "already has an achievement"],
            ["the same id twice in one call", { achievements: [{ id: "ACH_NEW" }, { id: "ACH_NEW" }] }, "already has an achievement"],
            ["an icon nothing matches", { achievements: [{ id: "ACH_NEW", iconAchieved: "no_such_icon" }] }, "no image asset"],
            ["an icon two assets share", { achievements: [{ id: "ACH_NEW", iconAchieved: "same.png" }] }, "names 2 image assets"],
            ["progress on a stat that does not exist", { achievements: [{ id: "ACH_NEW", progress: { stat: "Nope", max: 3 } }] }, "no stat in the catalog"],
            ["progress with no ceiling", { achievements: [{ id: "ACH_NEW", progress: { stat: "EndingsSeen", max: 0 } }] }, "above zero"],
        ];
        for (const [label, args, expected] of cases) {
            const { call, writes } = setup({
                achievements: [{ id: "ACH_OK", name: {}, description: {}, hidden: false }],
                stats: [{ id: "EndingsSeen", type: "int", defaultValue: 0 }],
            });
            const error = refusal(await call(STEAM_AGENT_TOOLS.addAchievements, args));
            expect(error?.message, label).toContain(expected);
            expect(writes, label).toHaveLength(0);
        }
    });

    it("fold update text in per language, and clear a language with an empty string", async () => {
        const { call, current } = setup({
            locales: ["en", "zh-CN"],
            achievements: [{ id: "ACH_ONE", name: { en: "One", "zh-CN": "一" }, description: { en: "First" }, hidden: false }],
        });
        await call(STEAM_AGENT_TOOLS.updateAchievements, {
            achievements: [{ id: "ACH_ONE", name: { "zh-CN": "第一" }, description: { en: "" } }],
        });
        expect(current().achievements[0]).toMatchObject({ name: { en: "One", "zh-CN": "第一" }, description: {} });
    });

    it("rename an achievement and say the backend has to be renamed too", async () => {
        const { call, current } = setup({ achievements: [{ id: "ACH_OLD", name: {}, description: {}, hidden: false }] });
        const result = await call(STEAM_AGENT_TOOLS.updateAchievements, { achievements: [{ id: "ACH_OLD", newId: "ACH_NEW" }] });
        expect(current().achievements.map(achievement => achievement.id)).toEqual(["ACH_NEW"]);
        expect(text(result)).toContain("Steamworks backend");
    });

    it("unbind progress on null, and bind it on an object", async () => {
        const { call, current } = setup({
            achievements: [{ id: "ACH_P", name: {}, description: {}, hidden: false, progress: { statId: "Count", max: 5 } }],
            stats: [{ id: "Count", type: "int", defaultValue: 0 }],
        });
        await call(STEAM_AGENT_TOOLS.updateAchievements, { achievements: [{ id: "ACH_P", progress: null }] });
        expect(current().achievements[0]!.progress).toBeUndefined();
        await call(STEAM_AGENT_TOOLS.updateAchievements, { achievements: [{ id: "ACH_P", progress: { stat: "Count", max: 7 } }] });
        expect(current().achievements[0]!.progress).toEqual({ statId: "Count", max: 7 });
    });

    it("clear an icon with an empty string", async () => {
        const { call, current } = setup({
            achievements: [{ id: "ACH_I", name: {}, description: {}, hidden: false, iconAchievedAssetId: "img-win" }],
        });
        await call(STEAM_AGENT_TOOLS.updateAchievements, { achievements: [{ id: "ACH_I", iconAchieved: "" }] });
        expect(current().achievements[0]!.iconAchievedAssetId).toBeUndefined();
    });

    it("refuse an update or a removal naming an achievement the catalog does not have", async () => {
        const { call, writes } = setup({ achievements: [{ id: "ACH_ONE", name: {}, description: {}, hidden: false }] });
        expect(refusal(await call(STEAM_AGENT_TOOLS.updateAchievements, { achievements: [{ id: "ACH_TWO" }] }))?.code).toBe("not_found");
        expect(refusal(await call(STEAM_AGENT_TOOLS.removeAchievements, { ids: ["ACH_ONE", "ACH_TWO"] }))?.code).toBe("not_found");
        expect(writes).toHaveLength(0);
    });

    it("remove achievements in one write", async () => {
        const { call, writes, current } = setup({
            achievements: [
                { id: "ACH_ONE", name: {}, description: {}, hidden: false },
                { id: "ACH_TWO", name: {}, description: {}, hidden: false },
            ],
        });
        await call(STEAM_AGENT_TOOLS.removeAchievements, { ids: ["ACH_ONE"] });
        expect(writes).toHaveLength(1);
        expect(current().achievements.map(achievement => achievement.id)).toEqual(["ACH_TWO"]);
    });

    it("replace the whole stat list, and refuse one that drops a bound stat", async () => {
        const { call, writes, current } = setup({
            achievements: [{ id: "ACH_P", name: {}, description: {}, hidden: false, progress: { statId: "Count", max: 5 } }],
            stats: [{ id: "Count", type: "int", defaultValue: 0 }, { id: "Spare", type: "float", defaultValue: 1.5 }],
        });
        const dropped = refusal(await call(STEAM_AGENT_TOOLS.setStats, { stats: [{ id: "Spare", type: "float" }] }));
        expect(dropped?.message).toContain("ACH_P needs Count");
        expect(writes).toHaveLength(0);

        await call(STEAM_AGENT_TOOLS.setStats, {
            stats: [{ id: "Count", type: "int", max: 5, incrementOnly: true }],
        });
        expect(writes).toHaveLength(1);
        expect(current().stats).toEqual([{ id: "Count", type: "int", defaultValue: 0, max: 5, incrementOnly: true }]);
    });

    it("refuse a stat list with a duplicate or a bad API Name", async () => {
        const { call, writes } = setup();
        expect(refusal(await call(STEAM_AGENT_TOOLS.setStats, { stats: [{ id: "A" }, { id: "A" }] }))?.message).toContain("listed twice");
        expect(refusal(await call(STEAM_AGENT_TOOLS.setStats, { stats: [{ id: "has space" }] }))?.message).toContain("not a Steam API Name");
        expect(writes).toHaveLength(0);
    });

    it("set the App ID and the languages, and refuse an App ID that is not a number", async () => {
        const { call, current } = setup();
        expect(refusal(await call(STEAM_AGENT_TOOLS.setSettings, { appId: "demo" }))?.message).toContain("not a number");
        await call(STEAM_AGENT_TOOLS.setSettings, { appId: "480", locales: ["en", "zh-CN", "en"] });
        expect(current()).toMatchObject({ appId: "480", locales: ["en", "zh-CN"] });
        await call(STEAM_AGENT_TOOLS.setSettings, { appId: "" });
        expect(current().appId).toBeUndefined();
        expect(refusal(await call(STEAM_AGENT_TOOLS.setSettings, {}))?.message).toContain("Nothing to change");
    });

    it("land a bare string in the catalog's first language", async () => {
        const { call, current } = setup({ locales: ["zh-CN", "en"] });
        await call(STEAM_AGENT_TOOLS.addAchievements, { achievements: [{ id: "ACH_S", name: "标题" }] });
        expect(current().achievements[0]!.name).toEqual({ "zh-CN": "标题" });
    });

    it("refuse every write on a frozen project, rather than dropping it the way the tab does", async () => {
        const { call, writes } = setup({}, { frozen: true });
        for (const [name, args] of [
            [STEAM_AGENT_TOOLS.setSettings, { appId: "480" }],
            [STEAM_AGENT_TOOLS.addAchievements, { achievements: [{ id: "ACH_NEW" }] }],
            [STEAM_AGENT_TOOLS.setStats, { stats: [] }],
        ] as [string, Record<string, unknown>][]) {
            expect(refusal(await call(name, args))?.code, name).toBe("unavailable");
        }
        expect(writes).toHaveLength(0);
        // The reading tool is not gated: an agent can still see the catalog it may not change.
        expect(text(await call(STEAM_AGENT_TOOLS.list, {}))).toContain("Steam catalog:");
    });

    it("report the catalog's own problems through list, rather than silently", async () => {
        const { call } = setup({ achievements: [{ id: "ACH_ONE", name: {}, description: {}, hidden: false }] });
        const result = await call(STEAM_AGENT_TOOLS.list, {});
        const data = (result as unknown as { data: { problems: { severity: string; message: string }[] } }).data;
        expect(data.problems.map(problem => problem.message)).toContain("No Steam App ID set");
        expect(data.problems.some(problem => problem.severity === "warning" && problem.message.includes("Missing name"))).toBe(true);
    });

    it("filter list by query, over API Names and authored text alike", async () => {
        const { call } = setup({
            achievements: [
                { id: "ACH_ROOFTOP", name: { en: "On the roof" }, description: {}, hidden: false },
                { id: "ACH_BEACH", name: { en: "Sand everywhere" }, description: {}, hidden: false },
            ],
        });
        const byName = (result: unknown) => ((result as { data: { achievements: { id: string }[] } }).data.achievements).map(item => item.id);
        expect(byName(await call(STEAM_AGENT_TOOLS.list, { query: "beach" }))).toEqual(["ACH_BEACH"]);
        expect(byName(await call(STEAM_AGENT_TOOLS.list, { query: "roof" }))).toEqual(["ACH_ROOFTOP"]);
        expect(byName(await call(STEAM_AGENT_TOOLS.list, {}))).toHaveLength(2);
    });
});
