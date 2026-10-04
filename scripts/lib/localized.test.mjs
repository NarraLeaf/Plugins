/**
 * Tests for the `localized` port. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * Studio reads `localized` for the plugin's name and description in the
 * editor's language, and refuses a manifest whose table is malformed. The
 * registry ignored the field, so CI would have passed a table Studio refuses at
 * install. The cases below are the refusals that port has to share.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validatePluginManifest } from "./plugins.mjs";

const manifest = localized => ({
    manifestVersion: 2,
    id: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    entries: { studio: "main.js" },
    localized,
});

function errorsFor(localized) {
    const result = validatePluginManifest(manifest(localized));
    return result.ok ? "" : result.errors.join("\n");
}

test("a table of names and descriptions by locale code is valid", () => {
    assert.equal(errorsFor({
        zh: { name: "演示", description: "演示插件" },
        ja: { name: "デモ" },
        "zh-x-neko": { description: "喵" },
    }), "");
});

test("an empty table declares nothing and is valid", () => {
    assert.equal(errorsFor({}), "");
});

test("the table has to be an object", () => {
    for (const localized of [[], "zh", 1, null]) {
        assert.match(errorsFor(localized), /must be an object keyed by locale code/, JSON.stringify(localized));
    }
});

test("keys are locale codes", () => {
    for (const code of ["ZH", "zh_CN", "chinese", "", "zh-"]) {
        assert.match(errorsFor({ [code]: { name: "x" } }), /invalid locale code/, code);
    }
});

test("each entry is an object", () => {
    assert.match(errorsFor({ zh: "演示" }), /must be an object with name and\/or description/);
});

test("name and description are strings", () => {
    assert.match(errorsFor({ zh: { name: 1 } }), /localized\["zh"\]\.name must be a string/);
    assert.match(errorsFor({ zh: { name: "演示", description: ["x"] } }), /\.description must be a string/);
});

test("an entry that translates nothing is refused, since it is usually a misspelt key", () => {
    assert.match(errorsFor({ zh: { title: "演示" } }), /must declare a name or a description/);
    assert.match(errorsFor({ zh: { name: "   " } }), /must declare a name or a description/);
});
