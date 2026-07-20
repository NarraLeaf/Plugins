#!/usr/bin/env node
/**
 * Regenerate index.json from the manifests under plugins/.
 *
 * index.json is derived, never hand-edited: manifest.json + package.json are
 * the single source of truth. Release URLs are computed from (id, version)
 * rather than read from the GitHub API, so a version bump and its index entry
 * land in the same reviewable PR — before the tag is pushed.
 *
 * Usage:
 *   node scripts/generate-index.mjs           # write index.json
 *   node scripts/generate-index.mjs --check   # fail if index.json is stale
 */

import fs from "node:fs";
import {
    buildIndex,
    indexPath,
    listPluginDirs,
    loadPlugin,
    writeJson,
} from "./lib/plugins.mjs";

const check = process.argv.includes("--check");

const loaded = listPluginDirs().map(dirName => loadPlugin(dirName));
const invalid = loaded.filter(plugin => !plugin.ok);

if (invalid.length) {
    console.error("Cannot generate index.json — fix these first (node scripts/validate.mjs):");
    for (const plugin of invalid) {
        console.error(`  plugins/${plugin.dirName}`);
        for (const error of plugin.errors) {
            console.error(`    - ${error}`);
        }
    }
    process.exit(1);
}

const next = buildIndex(loaded);
const serialized = `${JSON.stringify(next, null, 2)}\n`;

if (check) {
    const current = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, "utf-8") : "";
    if (current !== serialized) {
        console.error("index.json is out of date. Run: node scripts/generate-index.mjs");
        process.exit(1);
    }
    console.log(`index.json is up to date (${next.plugins.length} plugin(s)).`);
} else {
    writeJson(indexPath, next);
    console.log(`Wrote index.json with ${next.plugins.length} plugin(s).`);
}
