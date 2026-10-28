import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPack, compactElement, PackError } from "./build";
import { caveatsForKind, caveatsForSection, compareVersions, type PackFacts } from "./caveats";
import { queryInventory } from "./query";
import { parseShotTable, sectionWithChildren, splitReadme } from "./readme";

const README = [
    "# Sample → NarraLeaf 迁移补充包",
    "",
    "intro line",
    "",
    "## 0　硬性要求",
    "",
    "rules",
    "",
    "```",
    "## 9　not a heading inside a fence",
    "```",
    "",
    "## 5　流程与章节",
    "flow intro",
    "### 5.1　章节与文件",
    "chapters",
    "### 5.3　流程事实",
    "facts",
    "## 6　界面截图",
    "",
    "| 截图 | 对应界面 | 图 | 元素 | 说明 |",
    "| --- | --- | --- | --- | --- |",
    "| 主界面 | main_menu | [screens/shot-1.png](screens/shot-1.png) | 2 | 迁移者标注：主界面 |",
    "| 游戏界面 | say、quick_menu | [screens/shot-2.png](screens/shot-2.png) | 1 | 迁移者标注：游戏界面 |",
    "",
    "### 6.1　主界面",
    "details",
].join("\n");

const INVENTORY = {
    schemaVersion: 2,
    scanner: { name: "ren2leaf-diagnose", version: "0.2.0" },
    game: { name: "Sample", resolution: { width: 1280, height: 720 } },
    screens: [{ name: "main_menu", category: "standard" }, { name: "say", category: "standard" }],
    characters: [],
    needsReview: [],
    extensions: {
        speakers: { speakers: [{ variable: "s", displayName: "Sylvie", lines: 14 }, { variable: "m", displayName: "Me", lines: 22 }] },
        flow: {
            labels: [{ name: "start", file: "script.rpy" }, { name: "marry", file: "script.rpy" }, { name: "credits", file: "extra/end.rpy" }],
            menus: [],
            endings: [{ name: "marry", file: "script.rpy", line: 236 }],
            notEndings: [{ name: "credits", file: "extra/end.rpy", line: 1, reason: "excluded" }],
            files: [{ file: "script.rpy", lines: 240 }],
            dynamicTargets: [],
        },
        python: { entries: [], variables: [{ name: "book" }], persistent: [{ name: "cleared" }], functions: [], galleries: [], customStatements: [] },
        facts: { achievements: { declared: [], unlockPoints: [] }, transforms: { used: [] }, transitions: [{ name: "dissolve", count: 3 }], audio: [] },
        assets: { missing: [], duplicates: [] },
    },
};

const ELEMENTS = [
    {
        fileName: "shot-1.elements.json",
        json: {
            key: "shot-1",
            item: { kind: "manual", purpose: "主界面" },
            gameSize: [1280, 720],
            elements: [
                { type: "Image", class: "Image", rect: [0, 0, 10, 10], rect1920: [0, 0, 15, 15], depth: 2, n: 1, image: "gui/main_menu.png", location: ["game/screens.rpy", 299] },
                { type: "Text", class: "Text", rect: [1, 1, 2, 2], rect1920: [1.5, 1.5, 3, 3], text: "Start", info: "'Start'", inButton: true },
            ],
        },
    },
    { fileName: "shot-2.elements.json", json: { key: "shot-2", gameSize: [1280, 720], elements: [{ type: "Window", rect: [0, 0, 1, 1] }] } },
    { fileName: "shot-3.elements.json", json: { key: "shot-3", item: { purpose: "额外" }, elements: [] } },
];

test("splitReadme cuts at numbered headings and ignores fenced ones", () => {
    const sections = splitReadme(README);
    assert.deepEqual(sections.map(section => section.id), ["title", "0", "5", "5.1", "5.3", "6", "6.1"]);
    assert.equal(sections[0]!.title, "Sample → NarraLeaf 迁移补充包");
    assert.match(sections[1]!.body, /not a heading inside a fence/);
    assert.equal(sections.find(section => section.id === "5.3")!.title, "流程事实");
    assert.deepEqual(sectionWithChildren(sections, "5").map(section => section.id), ["5", "5.1", "5.3"]);
});

test("parseShotTable reads labels, screens and pictures", () => {
    const shots = parseShotTable(splitReadme(README));
    assert.deepEqual(shots, [
        { key: "shot-1", label: "主界面", screens: ["main_menu"], image: "screens/shot-1.png" },
        { key: "shot-2", label: "游戏界面", screens: ["say", "quick_menu"], image: "screens/shot-2.png" },
    ]);
});

test("buildPack stores the pack, keeps unlisted captures and turns decisions into rows", () => {
    const built = buildPack({
        sourcePath: "/packs/sample-ren2leaf",
        readme: README,
        inventory: INVENTORY,
        speakers: { version: 1, speakers: { s: { role: "main", name: "Sylvie", updatedAt: "2026-10-19T15:00:00Z" } } },
        chapters: { version: 1, mode: "choices", chapters: [{ id: "ch1", title: "第一章", files: ["script.rpy"] }], excluded: ["extra/end.rpy"] },
        elements: ELEMENTS,
    }, "2026-10-27T00:00:00Z");
    assert.equal(built.pack.game.name, "Sample");
    assert.equal(built.pack.game.width, 1280);
    assert.equal(built.pack.scanner.version, "0.2.0");
    assert.deepEqual(built.pack.shots.map(shot => [shot.key, shot.elementCount]), [["shot-1", 2], ["shot-2", 1], ["shot-3", 0]]);
    assert.equal(built.pack.shots[2]!.label, "额外");
    assert.deepEqual(built.screens.shots["shot-1"]!.elements[0], {
        type: "Image",
        rect: [0, 0, 15, 15],
        image: "gui/main_menu.png",
        location: "game/screens.rpy:299",
    });
    assert.deepEqual(built.screens.shots["shot-1"]!.elements[1], { type: "Text", rect: [1.5, 1.5, 3, 3], text: "Start", info: "'Start'", inButton: true });
    assert.deepEqual(built.decisions.map(decision => decision.id), ["pack:speaker:s", "pack:chapters"]);
    assert.equal(built.decisions[0]!.answer!.text, "role: main; name: Sylvie");
    assert.match(built.decisions[1]!.answer!.text!, /Split mode: choices\. 第一章: script\.rpy\. Excluded: extra\/end\.rpy\./);
    assert.ok(built.decisions.every(decision => decision.origin === "pack" && decision.seenByAgent));
});

test("buildPack refuses what is not a pack it can read", () => {
    const base = { sourcePath: "/p", readme: "", speakers: null, chapters: null, elements: [] };
    assert.throws(() => buildPack({ ...base, inventory: [] }, "now"), PackError);
    assert.throws(() => buildPack({ ...base, inventory: { scanner: {} } }, "now"), /no schemaVersion/);
    assert.throws(() => buildPack({ ...base, inventory: { schemaVersion: 3 } }, "now"), /schema 3/);
});

test("compactElement prefers the 1920 rect and keeps info only without an image", () => {
    assert.deepEqual(compactElement({ type: "Text", class: "Text", rect: [1, 1, 1, 1], info: "'x'" }), { type: "Text", rect: [1, 1, 1, 1], info: "'x'" });
    assert.deepEqual(compactElement({ type: "Button", class: "ImageButton", rect1920: [2, 2, 2, 2], image: "a.png", info: "x" }), {
        type: "Button",
        class: "ImageButton",
        rect: [2, 2, 2, 2],
        image: "a.png",
    });
});

test("queryInventory filters by key and file, and pages", () => {
    const inventory = INVENTORY as unknown as Record<string, unknown>;
    assert.equal(queryInventory(inventory, { kind: "speaker", key: "s" }).rows[0]!.displayName, "Sylvie");
    assert.deepEqual(queryInventory(inventory, { kind: "label", file: "end.rpy" }).rows.map(row => row.name), ["credits"]);
    const endings = queryInventory(inventory, { kind: "ending" });
    assert.deepEqual(endings.rows.map(row => [row.name, row.notEnding ?? false]), [["marry", false], ["credits", true]]);
    const variables = queryInventory(inventory, { kind: "variable" });
    assert.deepEqual(variables.rows.map(row => [row.name, row.persistent ?? false]), [["book", false], ["cleared", true]]);
    const page = queryInventory(inventory, { kind: "label", limit: 2 });
    assert.equal(page.rows.length, 2);
    assert.equal(page.total, 3);
    assert.equal(page.nextCursor, 2);
    assert.equal(queryInventory(inventory, { kind: "label", cursor: 2 }).nextCursor, null);
    assert.ok(queryInventory(inventory, { kind: "achievement" }).rows[0]!.declared);
    assert.equal(queryInventory({}, { kind: "screen" }).total, 0);
});

test("caveats apply by section and kind, and stop at the scanner that fixed them", () => {
    assert.ok(caveatsForSection("5.3", "0.2.0").some(caveat => caveat.id === "excluded-reachable"));
    assert.ok(caveatsForSection("8", "0.2.0").some(caveat => caveat.id === "image-geometry"));
    assert.equal(caveatsForSection("2", "0.2.0").length, 0);
    assert.ok(caveatsForKind("achievement", "0.1.9").length > 0);
    assert.equal(caveatsForKind("achievement", "0.3.0").length, 0);
    assert.equal(compareVersions("0.10.0", "0.2.0"), 1);
    assert.equal(compareVersions("0.2", "0.2.0"), 0);
});

test("a caveat about something the game does not have stays off its answers", () => {
    // A small game as Ren2Leaf 0.2.0 scanned it: no achievements, no gallery, no auto_voice, no
    // voice, no image statements, no menus, two endings that return, nothing excluded.
    const plain: PackFacts = {
        inventory: {
            extensions: {
                python: {
                    entries: [{ kind: "config", target: "config.has_voice", snippet: "define config.has_voice = False" }],
                    variables: [{ name: "book" }],
                },
                facts: { achievements: { wrappers: [], declared: [], unlockPoints: [], granted: [] } },
                assets: { summary: { imageDefinitions: 0 } },
                flow: { endings: [{ name: "marry" }], labels: [{ name: "start", reachable: true, out: [{ kind: "jump", to: "rightaway" }] }], menus: [] },
                speakers: { summary: { voicedLines: 0 }, voiceDirs: [] },
            },
        },
        chapters: { excluded: [] },
    };
    const ids = (list: { id: string }[]) => list.map(caveat => caveat.id).sort();
    assert.deepEqual(ids(["2", "3", "4", "5", "6", "7", "8"].flatMap(section => caveatsForSection(section, "0.2.0", plain))),
        ["chapter-terms", "defines-as-variables", "screens-one-state"]);
    assert.deepEqual(caveatsForKind("speaker", "0.2.0", plain), []);
    assert.deepEqual(caveatsForKind("achievement", "0.2.0", plain), []);

    // Each one comes back when the game has the thing.
    const python = (plain.inventory!.extensions as { python: { entries: object[] } }).python;
    python.entries.push(
        { kind: "config", target: "config.auto_voice", snippet: 'define config.auto_voice = "voice/{id}.ogg"' },
        { kind: "assign", snippet: "g = Gallery()" },
    );
    const flow = (plain.inventory!.extensions as { flow: { labels: { out: object[] }[] } }).flow;
    flow.labels[0]!.out.push({ kind: "jump", to: "splashscreen" });
    const ach = (plain.inventory!.extensions as { facts: { achievements: { declared: object[] } } }).facts.achievements;
    ach.declared.push({ name: "1" });
    assert.ok(caveatsForKind("speaker", "0.2.0", plain).some(caveat => caveat.id === "auto-voice"));
    assert.ok(caveatsForKind("gallery", "0.2.0", plain).some(caveat => caveat.id === "gallery-unknown"));
    assert.ok(caveatsForSection("5", "0.2.0", plain).some(caveat => caveat.id === "excluded-reachable"));
    assert.ok(caveatsForKind("achievement", "0.2.0", plain).length > 0);

    // A scan that does not say keeps every caveat, and so does a caller with no facts.
    assert.ok(caveatsForSection("8", "0.2.0", { inventory: {}, chapters: null }).some(caveat => caveat.id === "image-geometry"));
    assert.ok(caveatsForSection("8", "0.2.0").some(caveat => caveat.id === "image-geometry"));
});

test("queryInventory reads the voice file of each line under auto_voice", () => {
    const inventory = { extensions: { speakers: { autoVoice: { entries: [
        { file: "script.rpy", line: 18, id: "start_915cb944", voice: "voice/start_915cb944.ogg", exists: true },
        { file: "other.rpy", line: 4, id: "other_0a1b2c3d", voice: "voice/other_0a1b2c3d.ogg", exists: false },
    ] } } } };
    assert.equal(queryInventory(inventory, { kind: "voice" }).total, 2);
    assert.deepEqual(queryInventory(inventory, { kind: "voice", key: "other_0a1b2c3d" }).rows.map(row => row.line), [4]);
    assert.deepEqual(queryInventory(inventory, { kind: "voice", file: "script.rpy" }).rows.map(row => row.id), ["start_915cb944"]);
    assert.equal(queryInventory({ extensions: { speakers: {} } }, { kind: "voice" }).total, 0);
});

test("each caveat holds for the scanner versions it names, and open ones stay on for later scanners", () => {
    const ids = (list: { id: string }[]) => list.map(caveat => caveat.id).sort();
    const everywhere = (version: string) => ids(["3", "4", "5", "6", "7", "8"].flatMap(section => caveatsForSection(section, version)))
        .filter((id, index, all) => all.indexOf(id) === index);

    // Fixed in 0.3.0: on for a 0.2.0 pack only.
    const fixed = ["achievement-location", "auto-voice", "chapter-terms", "defines-as-variables", "excluded-reachable", "gallery-unknown", "image-geometry"];
    // Still in 0.3.0, or new in it, and not fixed by any Ren2Leaf yet.
    const open = ["excluded-entry-labels", "gallery-unlock-image", "interface-name-calls", "menus-unreachable", "notify-blueprint", "screens-one-state", "voice-before-pause"];

    const v020 = everywhere("0.2.0");
    for (const id of [...fixed, ...open]) assert.ok(v020.includes(id), `0.2.0 has ${id}`);
    assert.ok(!v020.includes("image-geometry-partial"), "the 0.3.0 geometry table does not exist in 0.2.0");

    const v030 = everywhere("0.3.0");
    for (const id of fixed) assert.ok(!v030.includes(id), `0.3.0 fixed ${id}`);
    for (const id of [...open, "image-geometry-partial"]) assert.ok(v030.includes(id), `0.3.0 has ${id}`);

    // A scanner newer than this list: what nobody has fixed stays on.
    assert.deepEqual(everywhere("0.4.1"), v030);
    assert.equal(caveatsForSection("6", "0.4.1")[0]!.id, "screens-one-state");
});

test("the 0.3.0 caveats look for what they are about in the scan", () => {
    const has = (facts: PackFacts, kind: Parameters<typeof caveatsForKind>[0], id: string) =>
        caveatsForKind(kind, "0.3.0", facts).some(caveat => caveat.id === id);
    const inventory = (extensions: Record<string, unknown>) => ({ extensions });

    // An excluded file that holds `start` (or splashscreen…) is run by the game whatever the table says.
    const files = { flow: { files: [
        { file: "script.rpy", says: 0, labels: [{ name: "splashscreen" }, { name: "start" }] },
        { file: "debug.rpy", says: 4, labels: [{ name: "test_box" }] },
    ] } };
    assert.ok(has({ inventory: inventory(files), chapters: { excluded: ["script.rpy"] } }, "file", "excluded-entry-labels"));
    assert.ok(!has({ inventory: inventory(files), chapters: { excluded: ["debug.rpy"] } }, "file", "excluded-entry-labels"));
    assert.ok(!has({ inventory: inventory(files), chapters: { excluded: [] } }, "file", "excluded-entry-labels"));
    assert.ok(has({ inventory: inventory(files), chapters: null }, "file", "excluded-entry-labels"), "a pack that does not say keeps it");

    // `unlock_image` is a picture the catalogue does not count.
    const gallery = (images: string[], unlocks: string[]) => inventory({ python: {
        entries: [{ callee: "g.button", snippet: 'g.button("one")' }],
        galleries: [{ gallery: "g", button: "one", images, unlocks, conditions: [] }],
    } });
    assert.ok(has({ inventory: gallery([], ["cg_one"]), chapters: null }, "gallery", "gallery-unlock-image"));
    assert.ok(!has({ inventory: gallery(["cg_one"], []), chapters: null }, "gallery", "gallery-unlock-image"));

    // A menu outside any label, or in one the game cannot reach.
    const menus = (label: string | null, reachable: boolean) => inventory({ flow: {
        labels: [{ name: "start", reachable: true }, { name: "test", reachable }],
        unreachable: reachable ? [] : [{ name: "test" }],
        menus: [{ file: "c1.rpy", line: 10, label: "start", choices: [] }, { file: "c1.rpy", line: 90, label, choices: [] }],
    } });
    assert.ok(has({ inventory: menus(null, true), chapters: null }, "menu", "menus-unreachable"));
    assert.ok(has({ inventory: menus("test", false), chapters: null }, "menu", "menus-unreachable"));
    assert.ok(!has({ inventory: menus("test", true), chapters: null }, "menu", "menus-unreachable"));

    // renpy.notify, by the API table or by an entry.
    assert.ok(has({ inventory: inventory({ python: { entries: [], apiUsage: [{ api: "renpy.notify", count: 2 }] } }), chapters: null }, "python", "notify-blueprint"));
    assert.ok(!has({ inventory: inventory({ python: { entries: [], apiUsage: [{ api: "renpy.pause", count: 2 }] } }), chapters: null }, "python", "notify-blueprint"));

    // Method calls on a name only the interface uses.
    const iface = (callee: string) => inventory({ python: {
        entries: [{ kind: "unknownCall", callee, snippet: `${callee}("x")` }],
        interfaceVariables: [{ name: "cg_rows" }],
    } });
    assert.ok(has({ inventory: iface("cg_rows.append"), chapters: null }, "python", "interface-name-calls"));
    assert.ok(!has({ inventory: iface("other.append"), chapters: null }, "python", "interface-name-calls"));

    // Voice that a pause takes: only for a game with voice.
    const voice = (voicedLines: number) => inventory({ speakers: { summary: { voicedLines }, voiceDirs: [] } });
    assert.ok(has({ inventory: voice(12), chapters: null }, "speaker", "voice-before-pause"));
    assert.ok(!has({ inventory: voice(0), chapters: null }, "speaker", "voice-before-pause"));

    // The 0.3.0 geometry table: on when it lists something, or when the game has an attribute hook.
    const geometry = (rows: object[], hooks: object[]) => inventory({ assets: { geometry: rows, autoGroups: [] }, python: { entries: [], hooks } });
    assert.ok(has({ inventory: geometry([{ name: "a" }], []), chapters: null }, "asset", "image-geometry-partial"));
    assert.ok(has({ inventory: geometry([], [{ hook: "config.adjust_attributes" }]), chapters: null }, "asset", "image-geometry-partial"));
    assert.ok(!has({ inventory: geometry([], []), chapters: null }, "asset", "image-geometry-partial"));
});

test("buildPack keeps an ImageButton's other states and reads the 0.3.0 split", () => {
    const element = compactElement({ type: "ImageButton", rect: [0, 0, 1, 1], image: "gui/start_idle.png", states: { idle: "gui/start_idle.png", hover: "gui/start_hover.png" } });
    assert.deepEqual(element.states, { idle: "gui/start_idle.png", hover: "gui/start_hover.png" });
    assert.equal(compactElement({ type: "Image", rect: [0, 0, 1, 1], states: {} }).states, undefined);

    const built = buildPack({
        sourcePath: "sample",
        readme: README,
        inventory: { ...INVENTORY, scanner: { name: "ren2leaf-diagnose", version: "0.3.0" } },
        speakers: null,
        chapters: { version: 2, split: { chapters: false, scenes: true, agent: false }, chapters: [{ id: "ch1", title: "", files: ["c1.rpy"] }], excluded: ["script.rpy"] },
        elements: [],
    }, "2026-10-28T00:00:00Z");
    const chapters = built.decisions.find(decision => decision.id === "pack:chapters")!;
    assert.match(chapters.answer!.text!, /^Split: chapters one chapter, scenes one per label\. ch1: c1\.rpy\. Excluded: script\.rpy\.$/);
});
