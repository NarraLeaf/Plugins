import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import manifest from "../manifest.json";

// Studio's rules for a plugin icon (`src/shared/constants/pluginIcon.ts`): square PNG, WebP or
// JPEG, 64-512 px a side, at most 512 KB. A declared icon that breaks them rejects the package.
test("the declared icon is a square PNG Studio accepts", () => {
    assert.equal(manifest.icon, "icon.png");
    const file = new URL("../icon.png", import.meta.url.replace(/\/\.test-out\/.*$/, "/src/"));
    const bytes = readFileSync(file);
    assert.deepEqual([...bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(width, height);
    assert.ok(width >= 64 && width <= 512, `${width}px`);
    assert.ok(statSync(file).size <= 512 * 1024);
});
