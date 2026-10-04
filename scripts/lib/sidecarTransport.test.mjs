/**
 * Tests for the sidecar transport name. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * This port has to refuse exactly what Studio refuses. It once also took `jsonl`, which Studio's
 * validator has never accepted, and narraleaf.steam-achievements 0.2.0 shipped saying it: green
 * here, refused at install for everyone.
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

test("takes the one transport Studio accepts", () => {
    assert.deepEqual(transportErrors(withSidecar({ transport: "stdio-jsonl" })), []);
});

test("refuses jsonl, which Studio refuses at install", () => {
    assert.deepEqual(transportErrors(withSidecar({ transport: "jsonl" })), [
        'sidecar "acme.demo.bridge" transport must be "stdio-jsonl"',
    ]);
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
