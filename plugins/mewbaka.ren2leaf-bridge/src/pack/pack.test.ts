import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPack, compactElement, PackError } from "./build";
import { caveatsForKind, caveatsForSection, compareVersions } from "./caveats";
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
