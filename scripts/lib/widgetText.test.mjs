/**
 * Tests for the `contributes.widgetText` port. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * Studio takes this key from the release that lets a plugin widget name the props that hold words a
 * player reads. The cases below hold the port to what Studio refuses: the key itself is accepted, a
 * widget the plugin does not declare is refused, and so are the props Studio would not take - a name
 * that is not an identifier, one the drawing writes itself, one used twice in a widget, or a key kept
 * in the words' own prop.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validatePluginManifest } from "./plugins.mjs";

const manifest = widgetText => ({
    manifestVersion: 2,
    id: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    entries: { studio: "main.js", runtime: "runtime.js" },
    contributes: { widgets: ["acme.demo.badge"], widgetText },
});

function errorsFor(widgetText) {
    const result = validatePluginManifest(manifest(widgetText));
    return result.ok ? "" : result.errors.join("\n");
}

test("a widget naming the props that hold words is valid", () => {
    assert.equal(errorsFor({
        "acme.demo.badge": [
            { prop: "caption", label: "Caption", localized: { zh: "说明", ja: "キャプション" } },
            { prop: "hint", keyProp: "hintKey", multiline: true },
        ],
    }), "");
});

test("a widget the plugin does not declare is refused", () => {
    assert.match(errorsFor({ "acme.demo.other": [{ prop: "caption" }] }), /not declared in contributes\.widgets/);
});

test("props Studio would not take are refused", () => {
    assert.match(errorsFor({ "acme.demo.badge": [] }), /non-empty array/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "a b" }] }), /invalid prop/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "runtimeTextOrigin" }] }), /invalid prop/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "caption", keyProp: "caption" }] }), /keeps its key in itself/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "caption" }, { prop: "caption" }] }), /more than once/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "caption", keyProp: "hint" }, { prop: "hint" }] }), /more than once/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "caption", localized: { zh_CN: "说明" } }] }), /invalid locale code/);
    assert.match(errorsFor({ "acme.demo.badge": [{ prop: "caption", multiline: "yes" }] }), /true or false/);
    assert.match(errorsFor(["acme.demo.badge"]), /object keyed by widget type/);
});
