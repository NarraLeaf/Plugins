/**
 * Compile nl-steam-bridge for the host platform and drop it, with the Steam
 * shared library it needs, into `bin/<platform-arch>/` for the plugin build to
 * pick up.
 *
 * Building needs no Valve partner account: `steamworks-sys` vendors the SDK
 * under its own `lib/steam/` and its build script falls back to that whenever
 * `STEAM_SDK_LOCATION` is unset. It also copies the right shared library for the
 * target into OUT_DIR, which is where this script takes it from — so the bytes
 * that ship are the same ones the binary was linked against.
 *
 * Host platform only, deliberately. A Windows host cannot set the executable bit
 * on a macOS or Linux artifact (NTFS has none) and would package something no
 * player can run; Studio's build preflight refuses those combinations for the
 * same reason. Each platform is built on its own runner — see
 * .github/workflows/release.yml.
 *
 * Usage: node sidecar/build.mjs [--debug]
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sidecarDir = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.dirname(sidecarDir);
const debug = process.argv.includes("--debug");
const profile = debug ? "debug" : "release";

/**
 * What each host produces. `libs` are the shared-library names the Steam SDK
 * uses there; the first one found in OUT_DIR is the one that ships.
 */
const HOSTS = {
    win32: {
        platformKey: "windows-x64",
        targets: ["x86_64-pc-windows-msvc"],
        binary: "nl-steam-bridge.exe",
        libs: ["steam_api64.dll"],
        // Windows searches the executable's own directory first, so the DLL
        // beside it is found with no link-time help.
        rustflags: null,
    },
    linux: {
        platformKey: "linux-x64",
        targets: ["x86_64-unknown-linux-gnu"],
        binary: "nl-steam-bridge",
        libs: ["libsteam_api.so"],
        // Without an $ORIGIN rpath the binary loads on the build machine (where
        // the SDK sits on the library path) and fails on every player's.
        rustflags: "-C link-arg=-Wl,-rpath,$ORIGIN",
    },
    darwin: {
        platformKey: "macos-universal",
        targets: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
        binary: "nl-steam-bridge",
        libs: ["libsteam_api.dylib"],
        rustflags: "-C link-arg=-Wl,-rpath,@executable_path",
    },
};

const host = HOSTS[process.platform];
if (!host) {
    console.error(`No sidecar build is defined for ${process.platform}.`);
    process.exit(1);
}

function cargo(args, extraEnv = {}) {
    console.log(`> cargo ${args.join(" ")}`);
    // No `shell: true`: cargo is a real executable on every platform (not a .cmd
    // shim), so Node resolves it directly — and a shell would concatenate these
    // arguments instead of passing them.
    execFileSync("cargo", args, {
        cwd: sidecarDir,
        stdio: "inherit",
        env: { ...process.env, ...extraEnv },
    });
}

const env = host.rustflags ? { RUSTFLAGS: host.rustflags } : {};
for (const target of host.targets) {
    cargo(["build", ...(debug ? [] : ["--release"]), "--target", target], env);
}

/** Where cargo put the binary for one target triple. */
function builtBinary(target) {
    return path.join(sidecarDir, "target", target, profile, host.binary);
}

const outDir = path.join(pluginDir, "bin", host.platformKey);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const outBinary = path.join(outDir, host.binary);

if (host.targets.length > 1) {
    // macOS: two slices fused into one image, so a single package serves both
    // Apple silicon and Intel.
    console.log("> lipo -create");
    execFileSync("lipo", ["-create", "-output", outBinary, ...host.targets.map(builtBinary)], { stdio: "inherit" });
} else {
    fs.copyFileSync(builtBinary(host.targets[0]), outBinary);
}
// Cargo's output is already executable; copying preserves that on POSIX, but
// lipo's output and any future path may not, so say so explicitly.
if (process.platform !== "win32") {
    fs.chmodSync(outBinary, 0o755);
}

/**
 * Find the shared library steamworks-sys copied next to its build output. Its
 * directory name carries a hash, so it is searched for rather than named.
 */
function findVendoredLib() {
    const roots = host.targets.map(target => path.join(sidecarDir, "target", target, profile, "build"));
    for (const root of roots) {
        if (!fs.existsSync(root)) {
            continue;
        }
        for (const entry of fs.readdirSync(root)) {
            if (!entry.startsWith("steamworks-sys-")) {
                continue;
            }
            for (const lib of host.libs) {
                const candidate = path.join(root, entry, "out", lib);
                if (fs.existsSync(candidate)) {
                    return candidate;
                }
            }
        }
    }
    return null;
}

const vendored = findVendoredLib();
if (!vendored) {
    console.error(
        `Built the binary but could not find ${host.libs.join(" or ")} in cargo's build output.\n` +
        "steamworks-sys copies it into OUT_DIR; without it the sidecar cannot load Steam on a player's machine.",
    );
    process.exit(1);
}
fs.copyFileSync(vendored, path.join(outDir, path.basename(vendored)));

console.log("");
console.log(`sidecar -> bin/${host.platformKey}/`);
for (const file of fs.readdirSync(outDir)) {
    const bytes = fs.readFileSync(path.join(outDir, file));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    console.log(`  ${file}  ${bytes.length} bytes  ${digest}`);
}
console.log("");
console.log("Now run `yarn build` — it copies these into dist/ and writes their digests into the manifest.");
