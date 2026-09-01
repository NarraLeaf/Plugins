/**
 * Tests for the address-pattern port. Run with `node --test scripts/lib/*.test.mjs`.
 *
 * This one is worth having for the reason the icon tests are: the rules it
 * covers are a port of Studio's, and a port that drifts accepts manifests
 * Studio refuses at install. The cases below are the ones the drift would show
 * up in first — the host wildcard, credentials, and the denied schemes, which
 * are the security-bearing half of `externalLinkPatternKey`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    externalLinkPatternKey,
    isValidExternalLinkPattern,
    validatePluginManifest,
} from "./plugins.mjs";

const manifest = contributes => ({
    manifestVersion: 2,
    id: "acme.demo",
    name: "Demo",
    version: "1.0.0",
    entries: { runtime: "runtime.js" },
    contributes,
});

test("a pattern is accepted when every part of it is one", () => {
    for (const pattern of [
        "https://store.steampowered.com/app/*",
        "steam://store/*",
        "steam://*",
        "https://*.example.com/app/*",
        "mailto:someone@example.com",
    ]) {
        assert.equal(isValidExternalLinkPattern(pattern), true, pattern);
    }
});

test("a `*` is a wildcard only as a whole host label", () => {
    // Read as a literal host these would look like a granted permission and
    // grant nothing, so they are refused rather than kept.
    assert.equal(isValidExternalLinkPattern("https://*x.example.com/"), false);
    assert.equal(isValidExternalLinkPattern("https://a.*.example.com/"), false);
});

test("credentials, missing schemes and denied schemes are not patterns", () => {
    for (const pattern of [
        "https://evil@store.example.com/",
        "https://user:pw@example.com/",
        "store.example.com/*",
        "javascript:alert(1)",
        "data:text/html,x",
        "vbscript:msgbox",
        "file:///C:/Windows/system32/cmd.exe",
        "",
        42,
    ]) {
        assert.equal(externalLinkPatternKey(pattern), null, String(pattern));
    }
});

test("the key ignores what a URL parser already normalizes", () => {
    // Which is what makes the duplicate check below see one declaration here.
    assert.equal(
        externalLinkPatternKey("HTTPS://Store.Example.com/App/"),
        externalLinkPatternKey("https://store.example.com/App/"),
    );
    assert.equal(externalLinkPatternKey("https://example.com:443/a"), "https://example.com/a");
    assert.equal(externalLinkPatternKey("https://example.com:8443/a"), "https://example.com:8443/a");
});

test("a manifest declaring the same address twice is refused", () => {
    const result = validatePluginManifest(manifest({
        externalLinks: ["https://x.example.com/", "HTTPS://X.example.com/"],
    }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /more than once/);
});

test("addresses without a runtime entry ask the author to approve nothing", () => {
    const result = validatePluginManifest({
        ...manifest({ externalLinks: ["https://x.example.com/"] }),
        entries: { studio: "main.js" },
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /requires a runtime entry/);
});

test("the install permission is derived, so writing it by hand is refused", () => {
    const result = validatePluginManifest({
        ...manifest({}),
        permissions: [{ kind: "externalLink", patterns: ["https://x.example.com/"] }],
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /derived from contributes/);
});
