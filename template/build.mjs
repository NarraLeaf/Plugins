/**
 * Bundles each entry declared in manifest.json into dist/.
 *
 * Mirrors how NarraLeaf-Studio builds its own built-in plugins: one prebundled
 * ESM file per entry, with the host modules left external. The host resolves
 * `narraleaf-studio/*`, `react` and `react-dom` through an import map at load
 * time — bundling them would produce a second, broken React instance.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(root, "dist");
const dev = process.argv.includes("--dev");

const EXTERNALS = [
    "narraleaf-studio/plugin",
    "narraleaf-studio/runtime",
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
];

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf-8"));

/** Map a declared entry (`main.js`) onto its source file (`src/main.ts`). */
function resolveSource(entry) {
    const { name } = path.parse(entry);
    for (const candidate of [`${name}.tsx`, `${name}.ts`, `${name}.jsx`, `${name}.js`]) {
        const full = path.join(root, "src", candidate);
        if (fs.existsSync(full)) {
            return full;
        }
    }
    throw new Error(`No source file found for declared entry "${entry}" (looked for src/${name}.{tsx,ts,jsx,js})`);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const target of ["studio", "runtime"]) {
    const entry = manifest.entries?.[target];
    if (typeof entry !== "string" || !entry.trim()) {
        continue;
    }
    const outfile = path.join(distDir, entry);
    fs.mkdirSync(path.dirname(outfile), { recursive: true });

    await esbuild.build({
        entryPoints: [resolveSource(entry)],
        outfile,
        bundle: true,
        platform: "browser",
        format: "esm",
        target: ["chrome114"],
        jsx: "automatic",
        sourcemap: dev,
        minify: !dev,
        external: EXTERNALS,
    });
    console.log(`built ${target} -> dist/${entry}`);
}

// Studio reads manifest.json from the installed directory, so it ships too.
fs.copyFileSync(path.join(root, "manifest.json"), path.join(distDir, "manifest.json"));
console.log("copied manifest.json");

// Same for the icon: Studio refuses a package whose declared icon is missing,
// so anything the manifest points at has to end up in dist/.
if (typeof manifest.icon === "string" && manifest.icon.trim()) {
    const relative = manifest.icon.trim().split(/[\\/]+/);
    const target = path.join(distDir, ...relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, ...relative), target);
    console.log(`copied ${manifest.icon}`);
}
