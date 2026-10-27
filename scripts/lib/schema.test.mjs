/**
 * Holds the editor schema to the validator's closed lists. Run with
 * `node --test scripts/lib/*.test.mjs`.
 *
 * schema/manifest.schema.json is what an author sees while typing a manifest,
 * and nothing in CI reads it, so a key or capability added to the validator and
 * not to the schema goes unnoticed until a valid manifest shows up underlined.
 * JSON Schema cannot state everything the validator checks, but the closed
 * lists it does state can be compared with the validator's own - which needs no
 * schema engine, so the registry root still needs no install.
 *
 * What this cannot see is the validator falling behind Studio; that half is
 * still a comparison against Studio's src/shared/utils/pluginManifest.ts.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
    BUILD_CONFIG_PLATFORMS,
    PLUGIN_BUILD_CONFIG_SCOPES,
    PLUGIN_BUILD_CONFIG_TYPES,
    PLUGIN_CONTRIBUTES_KEYS,
    PLUGIN_ENTRY_TARGETS,
    PLUGIN_RUNTIME_CAPABILITIES,
    PLUGIN_STRUCT_FIELD_TYPES,
    repoRoot,
} from "./plugins.mjs";

const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, "schema", "manifest.schema.json"), "utf-8"));
const sorted = list => [...list].sort();

test("the schema describes every contributes key the validator takes, and no other", () => {
    assert.deepEqual(sorted(Object.keys(schema.properties.contributes.properties)), sorted(PLUGIN_CONTRIBUTES_KEYS));
    // Closed on both sides, so a key the validator refuses is underlined as well.
    assert.equal(schema.properties.contributes.additionalProperties, false);
});

test("the schema lists every runtime capability the validator takes, and no other", () => {
    assert.deepEqual(
        sorted(schema.properties.contributes.properties.runtimeCapabilities.items.enum),
        sorted(PLUGIN_RUNTIME_CAPABILITIES),
    );
});

test("the schema's struct fields take the validator's field types, and no other", () => {
    const field = schema.properties.contributes.properties.structs.items.properties.fields.items.properties;
    assert.deepEqual(sorted(field.type.enum), sorted(PLUGIN_STRUCT_FIELD_TYPES));
});

test("the schema names the same entry targets", () => {
    assert.deepEqual(sorted(Object.keys(schema.properties.entries.properties)), sorted(PLUGIN_ENTRY_TARGETS));
});

test("the schema's build config field takes the validator's types, scopes and platforms", () => {
    const field = schema.definitions.buildConfigField.properties;
    assert.deepEqual(sorted(field.type.enum), sorted(PLUGIN_BUILD_CONFIG_TYPES));
    assert.deepEqual(sorted(field.scope.enum), sorted(PLUGIN_BUILD_CONFIG_SCOPES));
    assert.deepEqual(sorted(field.platforms.items.enum), sorted(BUILD_CONFIG_PLATFORMS));
});
