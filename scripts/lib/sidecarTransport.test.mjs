/**
 * Tests for the sidecar transport name. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * `stdio-jsonl` was the only accepted value until node sidecars moved to a utility process, where
 * the frames travel over the parent port and nothing goes over stdio. The name describes the
 * framing now, and the old spelling has to keep validating: it is written into manifests that were
 * published before the rename, and a validator that refused them would refuse plugins that work.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validatePluginManifest } from "./plugins.mjs";

const withSidecar = sidecar => ({
    manifestVersion: 2,
    id: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    entries: { runtime: "runtime.js" },
    contributes: {
        sidecars: [{
            id: "acme.demo.bridge",
            kind: "executable",
            autostart: "onRequest",
            targets: {
                "windows-x64": { entry: "bin/bridge.exe", include: ["bin/bridge.exe"] },
            },
            ...sidecar,
        }],
    },
});

const transportErrors = manifest =>
    validatePluginManifest(manifest).errors.filter(error => error.includes("transport"));

test("takes the name that describes the framing", () => {
    assert.deepEqual(transportErrors(withSidecar({ transport: "jsonl" })), []);
});

test("still takes the spelling published manifests were written with", () => {
    assert.deepEqual(transportErrors(withSidecar({ transport: "stdio-jsonl" })), []);
});

test("takes a sidecar that names no transport at all", () => {
    assert.deepEqual(transportErrors(withSidecar({})), []);
    // An explicit null reads as absent here, which is what `??` has always done with it. Noted
    // rather than asserted against: it is the language, not a decision this file gets to make.
    assert.deepEqual(transportErrors(withSidecar({ transport: null })), []);
});

test("refuses anything else, so a typo is not read as a default", () => {
    for (const transport of ["json", "stdio", "ndjson", "jsonl-v1", ""]) {
        assert.notDeepEqual(transportErrors(withSidecar({ transport })), [], String(transport));
    }
});
