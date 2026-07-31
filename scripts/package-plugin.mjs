#!/usr/bin/env node
/**
 * Build one plugin and package its distributable zip.
 *
 * The archive contains a single top-level folder named after the plugin id, so
 * unzipping yields exactly the directory a user points Studio's
 * "Install from folder" dialog at.
 *
 * Usage:
 *   node scripts/package-plugin.mjs <pluginId> [--install] [--out <dir>]
 *
 *   --install   run `yarn install --immutable` in the plugin directory first
 *   --out       output directory for the zip (default: .out/)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
    loadPlugin,
    pluginDir,
    releaseAssetName,
    repoRoot,
} from "./lib/plugins.mjs";
import { collectFiles, createZip } from "./lib/zip.mjs";

const argv = process.argv.slice(2);
const pluginId = argv.find(arg => !arg.startsWith("--"));
const runInstall = argv.includes("--install");
const outFlag = argv.indexOf("--out");
const outDir = outFlag >= 0 && argv[outFlag + 1] ? path.resolve(argv[outFlag + 1]) : path.join(repoRoot, ".out");

if (!pluginId) {
    console.error("Usage: node scripts/package-plugin.mjs <pluginId> [--install] [--out <dir>]");
    process.exit(1);
}

const plugin = loadPlugin(pluginId);
if (!plugin.ok) {
    console.error(`plugins/${pluginId} failed validation:`);
    for (const error of plugin.errors) {
        console.error(`  - ${error}`);
    }
    process.exit(1);
}

const dir = pluginDir(pluginId);
const { manifest } = plugin;

// Always go through corepack: it honours the plugin's own "packageManager"
// field. A bare `yarn` would resolve to whatever Yarn the machine has globally
// (often 1.x), which silently ignores packageManager and rejects Yarn 4 flags.
const isWindows = process.platform === "win32";
const COREPACK = isWindows ? "corepack.cmd" : "corepack";

function runYarn(args) {
    console.log(`> yarn ${args.join(" ")}`);
    execFileSync(COREPACK, ["yarn", ...args], {
        cwd: dir,
        stdio: "inherit",
        // Node >= 20 refuses to spawn .cmd shims without a shell on Windows.
        // Safe here: every argument is a hardcoded literal, never user input.
        shell: isWindows,
    });
}

if (runInstall) {
    runYarn(["install", "--immutable"]);
}
runYarn(["build"]);

const distDir = path.join(dir, "dist");
if (!fs.existsSync(distDir)) {
    console.error(`Build produced no dist/ directory in plugins/${pluginId}`);
    process.exit(1);
}

// The zip is what users install, so verify it against the manifest rather than
// trusting the plugin's own build script.
const missing = [];
if (!fs.existsSync(path.join(distDir, "manifest.json"))) {
    missing.push("manifest.json");
}
for (const target of ["studio", "runtime"]) {
    const entry = manifest.entries?.[target];
    if (typeof entry === "string" && !fs.existsSync(path.join(distDir, entry))) {
        missing.push(`${entry} (declared as entries.${target})`);
    }
}
// The build script has to copy the icon the way it copies manifest.json.
// Studio refuses a package whose declared icon is absent, so catching it here
// turns a failed install into a failed build.
if (typeof manifest.icon === "string" && manifest.icon.trim()) {
    const icon = manifest.icon.trim();
    if (!fs.existsSync(path.join(distDir, ...icon.split(/[\\/]+/)))) {
        missing.push(`${icon} (declared as icon — copy it into dist/ from your build script)`);
    }
}
if (missing.length) {
    console.error(`plugins/${pluginId}/dist is missing declared file(s):`);
    for (const item of missing) {
        console.error(`  - ${item}`);
    }
    process.exit(1);
}

const distManifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf-8"));
if (distManifest.id !== manifest.id || distManifest.version !== manifest.version) {
    console.error(`dist/manifest.json (${distManifest.id}@${distManifest.version}) does not match source manifest (${manifest.id}@${manifest.version})`);
    process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const assetName = releaseAssetName(manifest.id, manifest.version);
const assetPath = path.join(outDir, assetName);
const files = collectFiles(distDir, manifest.id);
fs.writeFileSync(assetPath, createZip(files));

console.log("");
console.log(`Packaged ${files.length} file(s) -> ${path.relative(repoRoot, assetPath)}`);
for (const file of files) {
    console.log(`  ${file.name}`);
}
