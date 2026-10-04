/**
 * Tests for the `contributes.network` port. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * Studio has taken this key since 0.6.0 and the registry did not, so a plugin
 * that declared where it fetches from could not pass CI at all. The cases below
 * hold the two halves of the port that drift would show up in: the key is
 * accepted, and the two rules network patterns add on top of external links
 * (http(s) only; a host and a written path) refuse what Studio refuses.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { validatePluginManifest } from "./plugins.mjs";

const manifest = (contributes, entries = { runtime: "runtime.js" }) => ({
    manifestVersion: 2,
    id: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    entries,
    contributes,
});

/** The errors one `network` list produces, joined so a test can match one message. */
function errorsFor(network) {
    const result = validatePluginManifest(manifest({ network }));
    return result.ok ? "" : result.errors.join("\n");
}

test("a manifest declaring where it fetches from is valid", () => {
    const result = validatePluginManifest(manifest({
        network: [
            "https://api.example.com/*",
            "https://api.example.com/v1/scores",
            "http://localhost:8080/dev/*",
            "https://*.example.com/data/*",
            "https://api.example.com/?format=json",
        ],
    }));
    assert.deepEqual(result.ok ? [] : result.errors, []);
});

test("the list has to be a list of non-empty strings", () => {
    assert.match(errorsFor("https://api.example.com/*"), /must be an array of address patterns/);
    assert.match(errorsFor(["", "https://api.example.com/*"]), /entries must be non-empty strings/);
    assert.match(errorsFor([42]), /entries must be non-empty strings/);
});

test("the external link rules apply first", () => {
    for (const pattern of [
        "api.example.com/*",
        "https://user:pw@api.example.com/*",
        "https://*x.example.com/*",
        "file:///C:/Windows/system32/cmd.exe",
        "javascript:alert(1)",
    ]) {
        assert.match(errorsFor([pattern]), /is not an address pattern/, pattern);
    }
});

test("only http and https are fetched from", () => {
    // A storefront scheme is an external link's business; nothing fetches from one.
    for (const pattern of ["steam://store/*", "wss://api.example.com/socket", "ftp://files.example.com/*"]) {
        assert.match(errorsFor([pattern]), /must be http or https/, pattern);
    }
});

test("a pattern has to name a host", () => {
    // `*` as the whole host is fine for an external link and means "anywhere" here.
    assert.match(errorsFor(["https://*/*"]), /must name a host/);
    assert.match(errorsFor(["http://*:8080/api/*"]), /must name a host/);
});

test("a bare host is refused with the spelling that means the whole host", () => {
    for (const pattern of ["https://api.example.com", "https://api.example.com/", "HTTPS://API.example.com"]) {
        const errors = errorsFor([pattern]);
        assert.match(errors, /names only the path "\/"/, pattern);
        assert.match(errors, /Write "https:\/\/api\.example\.com\/\*" for the whole host/, pattern);
    }
    // A port stays in the suggestion, since it is part of what was meant.
    assert.match(errorsFor(["http://localhost:8080"]), /Write "http:\/\/localhost:8080\/\*"/);
});

test("the same address declared twice is refused, compared as an address", () => {
    assert.match(
        errorsFor(["https://API.example.com/v1/*", "https://api.example.com/v1/*"]),
        /declares "https:\/\/api\.example\.com\/v1\/\*" more than once/,
    );
    assert.match(
        errorsFor(["https://api.example.com:443/v1/*", "https://api.example.com/v1/*"]),
        /more than once/,
    );
});

test("network and external links are separate lists", () => {
    // The same address in both is two answers to two questions, not a duplicate.
    const result = validatePluginManifest(manifest({
        externalLinks: ["https://store.example.com/app/*"],
        network: ["https://store.example.com/app/*"],
    }));
    assert.deepEqual(result.ok ? [] : result.errors, []);
});

test("hosts without a runtime entry ask the author to approve nothing", () => {
    const result = validatePluginManifest(manifest(
        { network: ["https://api.example.com/*"] },
        { studio: "main.js" },
    ));
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /contributes\.network requires a runtime entry/);
});

test("an empty list asks for nothing, so it needs no runtime entry", () => {
    const result = validatePluginManifest(manifest({ network: [] }, { studio: "main.js" }));
    assert.deepEqual(result.ok ? [] : result.errors, []);
});

test("the network permission cannot be written by hand", () => {
    // Studio derives it from this list; a hand-written one is refused there too.
    const result = validatePluginManifest({
        ...manifest({}),
        permissions: [{ kind: "network", patterns: ["https://api.example.com/*"] }],
    });
    assert.equal(result.ok, false);
});
