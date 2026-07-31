/**
 * Tests for the icon reader. Run with `node --test scripts/`.
 *
 * This file exists because nothing in the repository ships an icon — the
 * starter deliberately does not — so without it the port would be dead code
 * that CI never executes, right up until the first contributor's plugin is
 * accepted or refused by rules nobody has run.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
    pluginIconExtension,
    readImageDimensions,
    validatePluginIconBytes,
} from "./image.mjs";

const be32 = value => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
const be16 = value => [(value >>> 8) & 0xff, value & 0xff];
const le32 = value => [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
const ascii = value => [...value].map(character => character.charCodeAt(0));

/** PNG signature + an IHDR chunk, optionally padded out to a byte length. */
function png(width, height = width, padTo = 0) {
    const bytes = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 13, ...ascii("IHDR"),
        ...be32(width), ...be32(height),
        8, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    while (bytes.length < padTo) {
        bytes.push(0);
    }
    return Buffer.from(bytes);
}

/** SOI, an APP0 segment to skip over, then an SOF0 frame header. */
function jpeg(width, height = width) {
    return Buffer.from([
        0xff, 0xd8,
        0xff, 0xe0, 0x00, 0x06, ...ascii("JFIF"),
        0xff, 0xc0, 0x00, 0x11, 0x08, ...be16(height), ...be16(width), 0x03,
        0xff, 0xd9,
    ]);
}

function webp(chunk, payload) {
    const body = [...ascii("WEBP"), ...ascii(chunk), ...le32(payload.length), ...payload];
    const bytes = [...ascii("RIFF"), ...le32(body.length), ...body];
    while (bytes.length < 40) {
        bytes.push(0);
    }
    return Buffer.from(bytes);
}

test("reads PNG dimensions", () => {
    assert.deepEqual(readImageDimensions(png(512)), { format: "png", width: 512, height: 512 });
});

test("reads PNG dimensions past a chunk that precedes IHDR", () => {
    const leading = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0, 0, 0, 4, ...ascii("cLLi"), 1, 2, 3, 4, 0, 0, 0, 0,
        0, 0, 0, 13, ...ascii("IHDR"), ...be32(256), ...be32(128), 8, 6, 0, 0, 0, 0, 0, 0, 0,
    ]);
    assert.deepEqual(readImageDimensions(leading), { format: "png", width: 256, height: 128 });
});

test("reads JPEG dimensions from the start-of-frame marker", () => {
    assert.deepEqual(readImageDimensions(jpeg(300, 200)), { format: "jpeg", width: 300, height: 200 });
});

test("reads lossy WebP dimensions", () => {
    const payload = [0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x02, 0x00, 0x02];
    assert.deepEqual(readImageDimensions(webp("VP8 ", payload)), { format: "webp", width: 512, height: 512 });
});

test("reads lossless WebP dimensions", () => {
    const bits = (511 & 0x3fff) | ((255 & 0x3fff) << 14);
    assert.deepEqual(
        readImageDimensions(webp("VP8L", [0x2f, ...le32(bits >>> 0)])),
        { format: "webp", width: 512, height: 256 },
    );
});

test("reads extended WebP canvas dimensions", () => {
    const payload = [0, 0, 0, 0, 0xff, 0x01, 0x00, 0xff, 0x01, 0x00];
    assert.deepEqual(readImageDimensions(webp("VP8X", payload)), { format: "webp", width: 512, height: 512 });
});

test("returns null for bytes that are not a readable image", () => {
    assert.equal(readImageDimensions(Buffer.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))), null);
    assert.equal(readImageDimensions(Buffer.alloc(0)), null);
    assert.equal(readImageDimensions(png(512).subarray(0, 20)), null);
});

test("accepts the allowed extensions, case-insensitively", () => {
    assert.equal(pluginIconExtension("icon.png"), "png");
    assert.equal(pluginIconExtension("assets/Icon.PNG"), "png");
    assert.equal(pluginIconExtension("icon.webp"), "webp");
    assert.equal(pluginIconExtension("icon.jpeg"), "jpeg");
    assert.equal(pluginIconExtension("icon.svg"), null);
    assert.equal(pluginIconExtension("icon.gif"), null);
    assert.equal(pluginIconExtension("icon"), null);
});

test("accepts a square icon inside the size range", () => {
    assert.equal(validatePluginIconBytes(png(512), "icon.png"), null);
    assert.equal(validatePluginIconBytes(png(64), "icon.png"), null);
    assert.equal(validatePluginIconBytes(jpeg(128), "photo.JPG"), null);
});

test("refuses everything the rules refuse", () => {
    assert.match(validatePluginIconBytes(png(512, 256), "icon.png"), /square \(got 512x256\)/);
    assert.match(validatePluginIconBytes(png(513), "icon.png"), /at most 512x512/);
    assert.match(validatePluginIconBytes(png(32), "icon.png"), /at least 64x64/);
    assert.match(validatePluginIconBytes(png(512, 512, 512 * 1024 + 1), "icon.png"), /at most 512 KB/);
    // A file named .png that decodes as something else is either a mistake or an
    // attempt to smuggle a format past the extension allowlist.
    assert.match(validatePluginIconBytes(png(512), "icon.webp"), /is a PNG file with a \.webp name/);
    assert.match(validatePluginIconBytes(png(512), "icon.svg"), /must be one of/);
    const svg = Buffer.from(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    assert.match(validatePluginIconBytes(svg, "icon.png"), /not a readable PNG image/);
});
