#!/usr/bin/env node
/**
 * Validate every plugin under plugins/ (and the starter under template/).
 *
 * Checks each manifest against a port of Studio's own validator, so a plugin
 * that passes here is one Studio will accept at install time.
 *
 * Usage: node scripts/validate.mjs [pluginId ...]
 */

import fs from "node:fs";
import path from "node:path";
import {
    listPluginDirs,
    loadPlugin,
    repoRoot,
    templateDir,
} from "./lib/plugins.mjs";

const only = process.argv.slice(2);
const failures = [];
let checked = 0;

function report(label, result) {
    checked += 1;
    if (result.ok) {
        console.log(`  ok    ${label}`);
        return;
    }
    failures.push({ label, errors: result.errors });
    console.log(`  FAIL  ${label}`);
    for (const error of result.errors) {
        console.log(`          - ${error}`);
    }
}

const dirs = only.length ? only : listPluginDirs();

console.log(`Validating ${dirs.length} plugin(s) under plugins/`);
for (const dirName of dirs) {
    report(`plugins/${dirName}`, loadPlugin(dirName));
}

// The starter is not indexed, but it must stay installable — an unvalidated
// template rots silently and every new plugin inherits the rot.
if (!only.length && fs.existsSync(path.join(templateDir, "manifest.json"))) {
    console.log("Validating template/");
    report("template", loadPlugin(path.basename(templateDir), { root: repoRoot }));
}

console.log("");
if (failures.length) {
    console.error(`${failures.length} of ${checked} package(s) failed validation.`);
    process.exit(1);
}
console.log(`All ${checked} package(s) valid.`);
