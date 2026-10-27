// Builds the installable plugin folder: dist/ holds manifest.json, main.js, the icon and the agent guide,
// which is the directory the registry zips and an author picks in Studio's Install from folder.

import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "dist");

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "agent"), { recursive: true });

await build({
    entryPoints: [path.join(root, "src/main.tsx")],
    outfile: path.join(out, "main.js"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    charset: "utf8",
    legalComments: "none",
    // Studio provides these through its import map; bundling them would load a second React.
    external: [
        "narraleaf-studio/plugin",
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
    ],
});

await cp(path.join(root, "manifest.json"), path.join(out, "manifest.json"));
// The manifest declares it; Studio refuses the whole package when a declared icon is missing.
await cp(path.join(root, "icon.png"), path.join(out, "icon.png"));
await cp(path.join(root, "agent/guide.md"), path.join(out, "agent/guide.md"));

console.log(`Built ${path.relative(process.cwd(), out) || "."}`);
