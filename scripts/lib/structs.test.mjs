/**
 * Tests for the `contributes.structs` port. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * Studio takes this key from 1.4.0, which lets a plugin declare the row shapes its nodes hand out
 * (the Gallery plugin's entry, variant and group). The cases below hold the port to what Studio
 * refuses: the key itself is accepted, with or without a runtime entry, and refused are an id
 * without the plugin's prefix or used twice, a struct with no name or no fields, a field with no
 * key, a type a list does not understand, a key used twice, and a malformed name per locale.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validatePluginManifest } from "./plugins.mjs";

const manifest = (structs, entries = { studio: "main.js", runtime: "runtime.js" }) => ({
    manifestVersion: 2,
    id: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    entries,
    contributes: { blueprintNodes: ["acme.demo.getEntries"], structs },
});

function errorsFor(structs, entries) {
    const result = validatePluginManifest(manifest(structs, entries));
    return result.ok ? "" : result.errors.join("\n");
}

const entry = {
    id: "acme.demo.entry",
    name: "Entry",
    localized: { zh: "条目", ja: "エントリ" },
    fields: [
        { key: "id", type: "string" },
        { key: "title", type: "string" },
        { key: "thumbnail", type: "image" },
        { key: "unlocked", type: "boolean" },
        { key: "order", type: "number" },
        { key: "tint", type: "color" },
        { key: "extra", type: "json" },
    ],
};

test("structs declaring row shapes are valid", () => {
    assert.equal(errorsFor([entry, { id: "acme.demo.group", name: "Group", fields: [{ key: "name", type: "string" }] }]), "");
});

test("structs need no runtime entry: they derive no install permission", () => {
    assert.equal(errorsFor([entry], { studio: "main.js" }), "");
});

test("an id Studio would not take is refused", () => {
    assert.match(errorsFor([{ ...entry, id: "other.plugin.entry" }]), /prefixed with the plugin id: other\.plugin\.entry/);
    assert.match(errorsFor([{ ...entry, id: undefined }]), /prefixed with the plugin id: \(no id\)/);
    assert.match(errorsFor([entry, { ...entry }]), /declares "acme\.demo\.entry" more than once/);
});

test("a struct without a name or fields is refused", () => {
    assert.match(errorsFor([{ ...entry, name: " " }]), /\["acme\.demo\.entry"\] needs a name/);
    assert.match(errorsFor([{ ...entry, fields: [] }]), /needs at least one field/);
    assert.match(errorsFor([{ ...entry, fields: undefined }]), /needs at least one field/);
});

test("fields Studio would not take are refused", () => {
    assert.match(errorsFor([{ ...entry, fields: [{ type: "string" }] }]), /has a field with no key/);
    assert.match(errorsFor([{ ...entry, fields: ["title"] }]), /has a field with no key/);
    assert.match(errorsFor([{ ...entry, fields: [{ key: "title", type: "text" }] }]), /field "title" has an unsupported type: text/);
    assert.match(errorsFor([{ ...entry, fields: [{ key: "title" }] }]), /field "title" has an unsupported type: undefined/);
    assert.match(
        errorsFor([{ ...entry, fields: [{ key: "title", type: "string" }, { key: "title", type: "number" }] }]),
        /declares field "title" more than once/,
    );
});

test("a malformed name per locale is refused", () => {
    assert.match(errorsFor([{ ...entry, localized: ["条目"] }]), /localized must be an object keyed by locale code/);
    assert.match(errorsFor([{ ...entry, localized: { zh_CN: "条目" } }]), /invalid locale code: zh_CN/);
    assert.match(errorsFor([{ ...entry, localized: { zh: " " } }]), /localized\["zh"\] must be a non-empty string/);
});

test("structs that are not an array of objects are refused", () => {
    assert.match(errorsFor({ "acme.demo.entry": entry }), /contributes\.structs must be an array/);
    assert.match(errorsFor(["acme.demo.entry"]), /entries must be objects/);
});
