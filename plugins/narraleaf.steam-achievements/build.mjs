/**
 * Bundles each entry declared in manifest.json into dist/, then assembles the
 * manifest that actually ships.
 *
 * Same shape as template/build.mjs — one prebundled ESM file per entry, host
 * modules left external — plus the one thing a sidecar plugin needs: the
 * `contributes.sidecars` block is *generated here*, not authored.
 *
 * Why generated. A sidecar target is a claim about bytes: this package carries
 * this executable, and its sha256 is this. That claim is only true of a package
 * that actually has the binary, and the repository has none — they are build
 * output. Writing the block by hand would mean either placeholder digests (a lie
 * the validator cannot catch, and one that surfaces much later as a failed game
 * build) or a manifest describing files nobody has.
 *
 * So: for every platform in sidecar/contribution.json whose files are all
 * present under bin/, this copies them into dist/, hashes them, and emits the
 * target. Platforms with no binary are dropped with a line saying so. If none
 * survive, `contributes.sidecars` is omitted entirely — and that package is not
 * broken, it is the mirror-only build: every node still works, Steam is simply
 * never reached. See src/bridge.ts.
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

/* ------------------------------------------------------------------ sidecar */

const contributionPath = path.join(root, "sidecar", "contribution.json");
const included = [];
const dropped = [];

if (fs.existsSync(contributionPath)) {
    const contribution = JSON.parse(fs.readFileSync(contributionPath, "utf-8"));
    // Authoring aid only; it must not travel into the shipped manifest, whose
    // validator rejects keys it does not know.
    delete contribution.$comment;

    const targets = {};
    for (const [platformKey, target] of Object.entries(contribution.targets ?? {})) {
        const sources = target.include.map(include => ({
            include,
            source: path.join(root, ...include.split("/")),
        }));
        const absent = sources.filter(file => !fs.existsSync(file.source));
        if (absent.length) {
            dropped.push({ platformKey, absent: absent.map(file => file.include) });
            continue;
        }

        const sha256 = {};
        for (const { include, source } of sources) {
            const bytes = fs.readFileSync(source);
            sha256[include] = crypto.createHash("sha256").update(bytes).digest("hex");
            const destination = path.join(distDir, ...include.split("/"));
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(source, destination);
            // The OS loader opens a sidecar by path, so the executable bit has to
            // survive into the package. copyFileSync keeps the mode on POSIX;
            // setting it explicitly also covers a source that lost it.
            if (process.platform !== "win32" && include === target.entry) {
                fs.chmodSync(destination, 0o755);
            }
        }
        targets[platformKey] = { entry: target.entry, include: [...target.include], sha256 };
        included.push(platformKey);
    }

    if (included.length) {
        manifest.contributes = { ...manifest.contributes, sidecars: [{ ...contribution, targets }] };
    }
}

// Studio reads manifest.json from the installed directory, so the assembled one
// ships — not the source copy, which carries no sidecar block.
fs.writeFileSync(path.join(distDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
console.log("wrote dist/manifest.json");

if (typeof manifest.icon === "string" && manifest.icon.trim()) {
    const icon = manifest.icon.trim();
    const source = path.join(root, ...icon.split("/"));
    if (!fs.existsSync(source)) {
        throw new Error(`manifest declares icon "${icon}" but ${source} does not exist`);
    }
    const destination = path.join(distDir, ...icon.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
    console.log(`copied ${icon}`);
}

console.log("");
if (included.length) {
    console.log(`Steam bridge included for: ${included.join(", ")}`);
} else {
    console.log("Steam bridge: not included — this is a mirror-only package.");
    console.log("Every node still works; nothing is echoed to Steam. Run `yarn build:sidecar` first to include it.");
}
for (const { platformKey, absent } of dropped) {
    console.log(`  dropped ${platformKey} (missing ${absent.join(", ")})`);
}
