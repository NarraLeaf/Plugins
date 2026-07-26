/**
 * Bundles each entry declared in manifest.json into dist/, then copies the
 * sidecar payload the manifest declares.
 *
 * Same shape as template/build.mjs — one prebundled ESM file per entry, host
 * modules left external — plus two things a sidecar plugin needs:
 *
 * 1. Package-relative `contributes.sidecars[].targets[].include` files are
 *    copied into dist/ at exactly the paths the manifest names. Studio resolves
 *    them against the installed package root, which is what dist/ becomes.
 * 2. Every copied file is hashed and checked against the manifest's `sha256`.
 *    A mismatch is fatal: a package whose binary does not match its declared
 *    digest fails to install anyway, so failing here beats shipping it.
 *
 * A *missing* binary is a warning, not an error, so the JS half stays buildable
 * on a machine with no Rust toolchain. The release flow must not accept that
 * warning — see README "Building the sidecar".
 */

import crypto from "node:crypto";
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

const DEP_INCLUDE_PREFIX = "dep:";

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf-8"));

/** Map a declared entry (`main.js`) onto its source file (`src/main.tsx`). */
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

const missing = [];
for (const sidecar of manifest.contributes?.sidecars ?? []) {
    for (const [platformKey, target] of Object.entries(sidecar.targets ?? {})) {
        for (const include of target.include ?? []) {
            if (include.startsWith(DEP_INCLUDE_PREFIX)) {
                // Served by a build dependency: Studio fetches and verifies it at
                // project build time, so it is not in this package to copy.
                continue;
            }
            const source = path.join(root, ...include.split("/"));
            if (!fs.existsSync(source)) {
                missing.push(`${sidecar.id} ${platformKey}: ${include}`);
                continue;
            }
            const digest = crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
            const declared = String(target.sha256?.[include] ?? "").toLowerCase();
            if (digest !== declared) {
                throw new Error(
                    `sha256 mismatch for ${include}\n  manifest: ${declared}\n  actual:   ${digest}\n` +
                    "Update manifest.json (or rebuild the binary) — Studio rejects the package otherwise.",
                );
            }
            const destination = path.join(distDir, ...include.split("/"));
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(source, destination);
            console.log(`copied ${include}`);
        }
    }
}

// Studio reads manifest.json from the installed directory, so it ships too.
fs.copyFileSync(path.join(root, "manifest.json"), path.join(distDir, "manifest.json"));
console.log("copied manifest.json");

if (missing.length) {
    console.warn("");
    console.warn("WARNING: sidecar binaries are missing from this package:");
    for (const item of missing) {
        console.warn(`  - ${item}`);
    }
    console.warn("The bundle built, but the packaged plugin will FAIL to install:");
    console.warn("Studio verifies every declared sha256 at install time.");
    console.warn("See README.md -> Building the sidecar.");
}
