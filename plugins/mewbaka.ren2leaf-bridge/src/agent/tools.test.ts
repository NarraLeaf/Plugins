import { test } from "node:test";
import assert from "node:assert/strict";
import type { PluginAgentToolDef, PluginAgentToolResult, PluginApp } from "narraleaf-studio/plugin";
import manifest from "../../manifest.json";
import { advertisedName, PLUGIN_ID } from "../ids";
import { answerDecision } from "../model";
import { buildPack } from "../pack/build";
import { BridgeStore } from "../store";
import { createTools } from "./tools";

const ALLOWED_SCHEMA_KEYS = new Set(["type", "description", "properties", "required", "items", "enum", "additionalProperties", "minimum", "maximum", "default", "oneOf"]);

function schemaKeys(schema: unknown, found: Set<string>): Set<string> {
    if (typeof schema !== "object" || schema === null) return found;
    for (const [key, value] of Object.entries(schema)) {
        found.add(key);
        if (key === "properties") for (const child of Object.values(value as object)) schemaKeys(child, found);
        else if (key === "items" || key === "additionalProperties") schemaKeys(value, found);
        else if (key === "oneOf") for (const child of value as unknown[]) schemaKeys(child, found);
    }
    return found;
}

function harness(options: { frozen?: boolean; units?: { unitId: string; locale: string; text: string; character: null; durationSec: null }[] } = {}) {
    const disk = new Map<string, unknown>();
    const workspace = { frozen: options.frozen ?? false, freezeReason: options.frozen ? "manual" : null };
    const storage = {
        readJson: async (namespace: string) => (disk.get(namespace) as never) ?? null,
        writeJson: async (namespace: string, data: unknown) => void disk.set(namespace, structuredClone(data)),
    };
    const app = {
        plugin: { id: PLUGIN_ID },
        services: {
            voice: { listUnits: async () => options.units ?? [] },
            story: {
                listStories: () => [{ id: "story-1", name: "Main" }],
                listScenes: async () => [{ id: "scene-1", name: "Opening", storyId: "story-1" }, { id: "scene-2", name: "Opening", storyId: "story-1" }],
            },
        },
    } as unknown as PluginApp;
    const store = new BridgeStore(storage as never, workspace as never);
    const tools = new Map(createTools(app, store).map(def => [def.name.slice(PLUGIN_ID.length + 1), def]));
    const call = async (name: string, args: Record<string, unknown> = {}): Promise<PluginAgentToolResult> =>
        await tools.get(name)!.handler(args, { clientName: "test" });
    return { store, call, tools, disk, workspace };
}

function text(result: PluginAgentToolResult): string {
    if (typeof result === "string") return result;
    assert.ok(!("error" in result), `expected an answer, got ${JSON.stringify(result)}`);
    return result.text;
}

function refusal(result: PluginAgentToolResult): { code?: string; message: string; hint?: string } {
    assert.ok(typeof result === "object" && "error" in result, `expected a refusal, got ${JSON.stringify(result)}`);
    return result.error;
}

test("every tool matches its manifest declaration and Studio's limits", () => {
    const { tools } = harness();
    const declared = new Map(manifest.contributes.agentTools.map(entry => [entry.name, entry.write]));
    assert.equal(tools.size, declared.size);
    for (const def of tools.values() as Iterable<PluginAgentToolDef>) {
        assert.equal(declared.get(def.name), def.write, def.name);
        assert.match(def.name, /^[a-z0-9_.-]+$/);
        assert.match(advertisedName(def.name), /^[a-zA-Z0-9_-]{1,64}$/);
        assert.ok(def.title.length <= 80, `${def.name} title`);
        assert.ok(def.description.length <= 1200, `${def.name} description is ${def.description.length}`);
        assert.ok(JSON.stringify(def.inputSchema).length <= 20_000);
        for (const key of schemaKeys(def.inputSchema, new Set())) assert.ok(ALLOWED_SCHEMA_KEYS.has(key) || key === "required", `${def.name}: ${key}`);
    }
    assert.equal(advertisedName(`${PLUGIN_ID}.port_status`), "mewbaka_ren2leaf_bridge__port_status");
});

test("without a pack, status says so and the pack tools refuse", async () => {
    const { call } = harness();
    const status = text(await call("port_status"));
    assert.match(status, /Pack: none imported/);
    assert.match(status, /Checklist: empty/);
    assert.equal(refusal(await call("pack_section")).code, "unavailable");
    assert.equal(refusal(await call("pack_query", { kind: "label" })).code, "unavailable");
});

test("pack tools answer with caveats first and page long sections", async () => {
    const { store, call } = harness();
    const built = buildPack({
        sourcePath: "/packs/p",
        readme: `# P\n\n## 5　流程与章节\n${"x".repeat(25_000)}\n### 5.1　章节\nfiles\n## 6　界面截图\n| a | main_menu | [screens/s1.png](screens/s1.png) | 1 | n |`,
        inventory: { schemaVersion: 2, scanner: { name: "ren2leaf-diagnose", version: "0.2.0" }, game: { name: "P" }, extensions: { speakers: { speakers: [{ variable: "s" }] }, flow: { endings: [] } } },
        speakers: { speakers: { s: { role: "main" } } },
        chapters: null,
        elements: [{ fileName: "s1.elements.json", json: { key: "s1", elements: [{ type: "Text", rect1920: [1, 2, 3, 4], text: "Start" }] } }],
    }, "2026-10-27T00:00:00Z");
    await store.write({ pack: built.pack, inventory: built.inventory, screens: built.screens, decisions: { version: 1, items: built.decisions } });

    const list = text(await call("pack_section"));
    assert.match(list, /"section": "5"/);
    const first = text(await call("pack_section", { section: "5" }));
    assert.match(first.split("\n")[0]!, /^# Known pack error \(excluded-reachable\)/);
    assert.match(first, /next page: cursor 20000/);
    const second = text(await call("pack_section", { section: "5", cursor: 20_000 }));
    assert.match(second, /### 5\.1 章节/);
    assert.equal(refusal(await call("pack_section", { section: "9" })).code, "not_found");

    const speakers = text(await call("pack_query", { kind: "speaker", key: "s" }));
    assert.match(speakers, /# Known pack error \(auto-voice\)/);
    assert.match(speakers, /"migrator": \{\s+"role": "main"/);

    const screen = text(await call("pack_screen", { screen: "main_menu" }));
    assert.match(screen, /Capture s1 "a", screens: main_menu/);
    assert.match(screen, /"text": "Start"/);
    assert.equal(refusal(await call("pack_screen", { screen: "nope" })).code, "not_found");

    const missing = await call("pack_screen", { screen: "s1", image: true }) as { text: string; image?: unknown };
    assert.equal(missing.image, undefined);
    assert.match(missing.text, /no stored screenshot/);
    await store.write({ images: { version: 1, files: {
        "screens/s1.png": { kind: "screenshot", label: "a", mimeType: "image/jpeg", data: "/9j/" },
        "screens/s1-1.png": { kind: "crop", label: "start button", mimeType: "image/png", data: "iVBO" },
        "characters/s.png": { kind: "portrait", label: "s", mimeType: "image/png", data: "iVBP" },
    } } });
    const shown = await call("pack_screen", { screen: "s1", image: true }) as { text: string; image?: unknown };
    assert.deepEqual(shown.image, { mimeType: "image/jpeg", data: "/9j/" });
    assert.match(shown.text, /screens\/s1-1\.png "start button"/);

    assert.match(text(await call("pack_image", { kind: "portrait" })), /"path": "characters\/s.png"/);
    const portrait = await call("pack_image", { path: "./characters/s.png" }) as { text: string; image?: unknown };
    assert.deepEqual(portrait.image, { mimeType: "image/png", data: "iVBP" });
    assert.equal(refusal(await call("pack_image", { path: "characters/x.png" })).code, "not_found");
});

test("an answer from the author reaches the agent at the top of its next answer", async () => {
    const { store, call } = harness();
    const asked = text(await call("decision_ask", { question: "Keep the extra ending?", options: [{ label: "Keep" }, { label: "Drop" }], recommended: "a" }));
    assert.match(asked, /Asked as d-1/);
    await store.write({ decisions: answerDecision(store.snapshot.decisions, "d-1", { optionId: "a" }, "2026-10-27T01:00:00Z") });
    const next = text(await call("port_status"));
    assert.match(next.split("\n")[0]!, /^# Ren2Leaf Bridge: The author answered d-1 \("Keep the extra ending\?"\): a\) Keep/);
    assert.match(text(await call("decision_seen", { ids: ["d-1"] })), /Marked 1 as read/);
    assert.doesNotMatch(text(await call("port_status")), /^# Ren2Leaf Bridge/);
});

test("rules and the freeze come back as refusals", async () => {
    const { call, workspace, disk } = harness();
    const dropped = refusal(await call("ledger_upsert", { items: [{ id: "a", area: "extras", title: "Gallery", plan: "p", status: "dropped" }] }));
    assert.match(dropped.message, /dropped without a decision/);
    assert.match(dropped.hint!, /decision_ask/);
    workspace.frozen = true;
    assert.match(refusal(await call("log_note", { phase: "story" })).message, /read-only/);
    assert.equal(disk.size, 0);
});

test("line records resolve the scene and feed the voice check", async () => {
    const { call } = harness({ units: [{ unitId: "u-old", locale: "ja", text: "", character: null, durationSec: null }] });
    assert.match(refusal(await call("lines_record", { scene: "Opening", entries: [] })).message, /names 2 scenes/);
    assert.equal(refusal(await call("lines_record", { scene: "Missing", entries: [] })).code, "not_found");
    const recorded = text(await call("lines_record", {
        scene: "scene-1",
        entries: [{ file: "c1.rpy", line: 120, unitId: "u-old", voiceFile: "voice/1.ogg" }, { file: "c1.rpy", line: 121, unitId: "u-new", voiceFile: "voice/2.ogg" }],
    }));
    assert.match(recorded, /Recorded 2 lines for scene "Opening"/);
    const check = text(await call("voice_check", { scene: "scene-1" }));
    assert.match(check, /^# 0\/2 recorded voiced lines have a take; 1 records are stale .*; 1 lines have no take yet/);
    assert.match(check, /"kind": "stale"/);
    assert.match(text(await call("port_status")), /Line records: 2 lines in 1 scenes\. Voice: 0\/2/);
});
