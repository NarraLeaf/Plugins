/**
 * The agent tools against a stand-in for Studio: that each write tool commits exactly once — which
 * is what makes one call one step of undo once the host captures it — and refuses the whole call,
 * writing nothing, when any part of it is wrong.
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
    const app = { services: { workspace: { frozen } } } as unknown as PluginApp;
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

function data(result: unknown): Record<string, unknown> {
    return (result as unknown as { data: Record<string, unknown> }).data;
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
        const results = [
            await call(STEAM_AGENT_TOOLS.list, {}),
            await call(STEAM_AGENT_TOOLS.setAppId, { appId: "480" }),
            await call(STEAM_AGENT_TOOLS.addAchievements, { ids: ["ACH_ONE"] }),
            await call(STEAM_AGENT_TOOLS.setStats, { stats: [] }),
        ];
        for (const result of results) {
            expect(text(result)).toContain("/unlock ACH_NAME");
            expect(text(result)).toContain("Unlock Achievement blueprint node");
        }
    });

    it("say, in list, that the text players read lives in the Steamworks backend", async () => {
        const { call } = setup();
        const answer = text(await call(STEAM_AGENT_TOOLS.list, {}));
        expect(answer).toContain("partner.steamgames.com");
        expect(answer).toContain("name, description, icons and hidden flag");
    });

    it("declare achievements in one write", async () => {
        const { call, writes, current } = setup();
        const result = await call(STEAM_AGENT_TOOLS.addAchievements, { ids: ["ACH_FIRST", "ACH_ALL"] });
        expect(text(result)).toContain("Declared 2 achievements");
        expect(text(result)).toContain("Steamworks backend");
        expect(writes).toHaveLength(1);
        expect(current().achievements).toEqual([{ id: "ACH_FIRST" }, { id: "ACH_ALL" }]);
        expect(current().version).toBe(CATALOG_VERSION);
    });

    it("refuse the whole call, writing nothing, when one name is wrong", async () => {
        const cases: [string, Record<string, unknown>, string][] = [
            ["a name Steam would reject", { ids: ["ACH_NEW", "no spaces here"] }, "not a Steam API Name"],
            ["a name already declared", { ids: ["ACH_OK"] }, "already has an achievement"],
            ["the same name twice in one call", { ids: ["ACH_NEW", "ACH_NEW"] }, "already has an achievement"],
            ["an empty name", { ids: [""] }, "is required"],
            ["a name over 44 characters", { ids: [`ACH_${"X".repeat(45)}`] }, "not a Steam API Name"],
            ["no names at all", { ids: [] }, "non-empty array"],
        ];
        for (const [label, args, expected] of cases) {
            const { call, writes } = setup({ achievements: [{ id: "ACH_OK" }] });
            expect(refusal(await call(STEAM_AGENT_TOOLS.addAchievements, args))?.message, label).toContain(expected);
            expect(writes, label).toHaveLength(0);
        }
    });

    it("rename achievements, keeping what a 0.1 catalog carried on the entry", async () => {
        const { call, writes, current } = setup({
            achievements: [{ id: "ACH_OLD", name: { en: "Old words" }, hidden: true }],
        });
        const result = await call(STEAM_AGENT_TOOLS.renameAchievements, { renames: [{ id: "ACH_OLD", newId: "ACH_NEW" }] });
        expect(writes).toHaveLength(1);
        expect(current().achievements).toEqual([{ id: "ACH_NEW", name: { en: "Old words" }, hidden: true }]);
        // Both the places a rename has to be repeated, in the answer rather than only in the guide.
        expect(text(result)).toContain("Steamworks backend");
        expect(text(result)).toContain("story row or node");
    });

    it("refuse a rename onto a name the catalog already has, or from one it does not", async () => {
        const { call, writes } = setup({ achievements: [{ id: "ACH_ONE" }, { id: "ACH_TWO" }] });
        expect(refusal(await call(STEAM_AGENT_TOOLS.renameAchievements, { renames: [{ id: "ACH_ONE", newId: "ACH_TWO" }] }))?.message)
            .toContain("already has an achievement");
        expect(refusal(await call(STEAM_AGENT_TOOLS.renameAchievements, { renames: [{ id: "ACH_NONE", newId: "ACH_X" }] }))?.code)
            .toBe("not_found");
        expect(writes).toHaveLength(0);
    });

    it("remove achievements in one write, and refuse one the catalog does not have", async () => {
        const { call, writes, current } = setup({ achievements: [{ id: "ACH_ONE" }, { id: "ACH_TWO" }] });
        expect(refusal(await call(STEAM_AGENT_TOOLS.removeAchievements, { ids: ["ACH_ONE", "ACH_NONE"] }))?.code).toBe("not_found");
        expect(writes).toHaveLength(0);
        await call(STEAM_AGENT_TOOLS.removeAchievements, { ids: ["ACH_ONE"] });
        expect(writes).toHaveLength(1);
        expect(current().achievements).toEqual([{ id: "ACH_TWO" }]);
    });

    it("replace the whole stat list in one write", async () => {
        const { call, writes, current } = setup({
            stats: [{ id: "Count", type: "int", defaultValue: 0 }, { id: "Spare", type: "float", defaultValue: 1.5 }],
        });
        await call(STEAM_AGENT_TOOLS.setStats, { stats: [{ id: "Count", type: "int", max: 5, incrementOnly: true }] });
        expect(writes).toHaveLength(1);
        expect(current().stats).toEqual([{ id: "Count", type: "int", defaultValue: 0, max: 5, incrementOnly: true }]);
        await call(STEAM_AGENT_TOOLS.setStats, { stats: [] });
        expect(current().stats).toEqual([]);
    });

    it("refuse a stat list with a duplicate, a bad API Name, or a range the wrong way round", async () => {
        const cases: [string, Record<string, unknown>, string][] = [
            ["a duplicate", { stats: [{ id: "A" }, { id: "A" }] }, "listed twice"],
            ["a bad name", { stats: [{ id: "has space" }] }, "not a Steam API Name"],
            ["min above max", { stats: [{ id: "A", min: 10, max: 1 }] }, "is above max"],
            ["not an array", { stats: "A" }, "must be an array"],
        ];
        for (const [label, args, expected] of cases) {
            const { call, writes } = setup();
            expect(refusal(await call(STEAM_AGENT_TOOLS.setStats, args))?.message, label).toContain(expected);
            expect(writes, label).toHaveLength(0);
        }
    });

    it("set and clear the App ID, and refuse one that is not a number", async () => {
        const { call, current, writes } = setup();
        expect(refusal(await call(STEAM_AGENT_TOOLS.setAppId, { appId: "demo" }))?.message).toContain("not a number");
        expect(writes).toHaveLength(0);
        await call(STEAM_AGENT_TOOLS.setAppId, { appId: "480" });
        expect(current().appId).toBe("480");
        expect(text(await call(STEAM_AGENT_TOOLS.setAppId, { appId: "" }))).toContain("Cleared");
        expect(current().appId).toBeUndefined();
    });

    it("refuse every write on a frozen project, rather than dropping it the way the panel does", async () => {
        const { call, writes } = setup({ achievements: [{ id: "ACH_ONE" }] }, { frozen: true });
        for (const [name, args] of [
            [STEAM_AGENT_TOOLS.setAppId, { appId: "480" }],
            [STEAM_AGENT_TOOLS.addAchievements, { ids: ["ACH_NEW"] }],
            [STEAM_AGENT_TOOLS.renameAchievements, { renames: [{ id: "ACH_ONE", newId: "ACH_TWO" }] }],
            [STEAM_AGENT_TOOLS.removeAchievements, { ids: ["ACH_ONE"] }],
            [STEAM_AGENT_TOOLS.setStats, { stats: [] }],
        ] as [string, Record<string, unknown>][]) {
            expect(refusal(await call(name, args))?.code, name).toBe("unavailable");
        }
        expect(writes).toHaveLength(0);
        // The reading tool is not gated: an agent can still see the catalog it may not change.
        expect(text(await call(STEAM_AGENT_TOOLS.list, {}))).toContain("Steam catalog:");
    });

    it("report the catalog's own problems through list, rather than silently", async () => {
        const { call } = setup({ achievements: [{ id: "ACH_ONE" }] });
        const problems = data(await call(STEAM_AGENT_TOOLS.list, {})).problems as { severity: string; message: string }[];
        expect(problems.some(problem => problem.severity === "warning")).toBe(true);
    });

    it("name the fields a 0.1 entry still carries, without printing them", async () => {
        const { call } = setup({ achievements: [{ id: "ACH_OLD", name: { en: "Old" }, hidden: true }, { id: "ACH_NEW" }] });
        const achievements = data(await call(STEAM_AGENT_TOOLS.list, {})).achievements as Record<string, unknown>[];
        expect(achievements[0]!.carriedFields).toEqual(["name", "hidden"]);
        expect(achievements[0]).not.toHaveProperty("name");
        expect(achievements[1]).toEqual({ id: "ACH_NEW" });
    });

    it("filter list by API Name", async () => {
        const { call } = setup({ achievements: [{ id: "ACH_ROOFTOP" }, { id: "ACH_BEACH" }] });
        const ids = (result: unknown) => (data(result).achievements as { id: string }[]).map(item => item.id);
        expect(ids(await call(STEAM_AGENT_TOOLS.list, { query: "beach" }))).toEqual(["ACH_BEACH"]);
        expect(ids(await call(STEAM_AGENT_TOOLS.list, {}))).toHaveLength(2);
    });
});
