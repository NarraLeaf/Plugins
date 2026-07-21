/**
 * Bundles each entry declared in manifest.json into dist/, then copies the
 * declared locale catalogs alongside them.
 *
 * Mirrors how NarraLeaf-Studio builds its own built-in plugins: one prebundled
 * ESM file per entry, with the host modules left external. The host resolves
 * `narraleaf-studio/*`, `react` and `react-dom` through an import map at load
 * time — bundling them would produce a second, broken React instance.
 *
 * Unlike the starter template, this plugin also ships `contributes.locales`
 * message files. Those are plain data, not code: esbuild never sees them, so
 * they must be copied into dist/ verbatim (at the same relative path the
 * manifest declares) or the installed package would have no translations.
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

// Copy every declared locale catalog verbatim. Studio reads these from the
// installed directory relative to the manifest, so they must ship at the exact
// path manifest.json declares.
for (const locale of manifest.contributes?.locales ?? []) {
    const rel = typeof locale?.messages === "string" ? locale.messages.trim() : "";
    if (!rel) {
        continue;
    }
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) {
        throw new Error(`Declared locale "${locale.code}" points at missing file ${rel}`);
    }
    const dest = path.join(distDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`copied ${rel}`);
}

// Studio reads manifest.json from the installed directory, so it ships too.
fs.copyFileSync(path.join(root, "manifest.json"), path.join(distDir, "manifest.json"));
console.log("copied manifest.json");
