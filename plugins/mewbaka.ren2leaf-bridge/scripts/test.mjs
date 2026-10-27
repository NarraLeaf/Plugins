// Unit tests: each src/**/*.test.ts is bundled on its own and run with node's test runner. The
// modules under test import only types from the plugin API, so nothing from Studio is needed.

import { build } from "esbuild";
import { readdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, ".test-out");

async function findTests(dir) {
    const found = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...await findTests(full));
        else if (entry.name.endsWith(".test.ts")) found.push(full);
    }
    return found;
}

await rm(out, { recursive: true, force: true });
const tests = await findTests(path.join(root, "src"));
await build({
    entryPoints: tests,
    outdir: out,
    outbase: path.join(root, "src"),
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: ["node:*"],
});

const files = tests.map(file => path.join(out, path.relative(path.join(root, "src"), file)).replace(/\.ts$/, ".mjs"));
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
