/**
 * Shared helpers for the plugin registry tooling.
 *
 * Deliberately dependency-free so the repository root needs no install step:
 * `node scripts/<name>.mjs` works on a fresh clone.
 *
 * `validatePluginManifest` below is a port of Studio's authoritative validator
 * at src/shared/utils/pluginManifest.ts. If that file changes, this one must be
 * updated to match, otherwise CI will accept manifests Studio rejects at install.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const pluginsDir = path.join(repoRoot, "plugins");
export const templateDir = path.join(repoRoot, "template");
export const indexPath = path.join(repoRoot, "index.json");

export const REPOSITORY_URL = "https://github.com/NarraLeaf/Plugins";
export const INDEX_FORMAT_VERSION = 1;

/** Studio only understands manifestVersion 2. v1 is hard-rejected at install. */
export const PLUGIN_MANIFEST_VERSION = 2;
export const PLUGIN_ENTRY_TARGETS = ["studio", "runtime"];
/** Contribution kinds whose value is an array of `<pluginId>.`-prefixed type strings. */
export const PLUGIN_CONTRIBUTES_TYPE_KEYS = ["blueprintNodes", "widgets", "runtimeData"];
/** Every recognized contributes key, including the object-shaped ones. */
export const PLUGIN_CONTRIBUTES_KEYS = [
    ...PLUGIN_CONTRIBUTES_TYPE_KEYS,
    "locales",
    "runtimeCapabilities",
    "sidecars",
    "buildDependencies",
];

/**
 * Capability domains a plugin's `runtime` entry may declare. Closed list: an
 * unknown capability fails validation rather than being ignored, so a typo can
 * never read as "asked for nothing".
 */
export const PLUGIN_RUNTIME_CAPABILITIES = [
    "store",
    "events",
    "state.read",
    "state.write",
    "saves.read",
    "saves.write",
    "ui.overlay",
    "assets",
    "locale",
];

/**
 * Permission kinds Studio *derives* from `contributes`. Writing one by hand is a
 * second source of truth for the same capability, which is how an install prompt
 * and a plugin's real reach drift apart — so it is rejected, not merged.
 */
export const PLUGIN_DERIVED_PERMISSION_KINDS = ["runtime", "sidecar", "buildDependency"];

/** Desktop only: web has no process to spawn and the mobile shells are WebViews. */
const BINARY_PLATFORMS = ["windows", "macos", "linux"];
const BINARY_ARCHS = ["x64", "arm64", "universal"];

const SIDECAR_DEFAULTS = {
    kind: "executable",
    transport: "stdio-jsonl",
    autostart: "onGameStart",
    startupTimeoutMs: 5000,
    shutdownTimeoutMs: 3000,
    restart: { maxRetries: 3, backoffMs: 1000 },
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
/** `dep:<buildDependencyId>/<path>` — an include served by a build dependency. */
const DEP_INCLUDE_PREFIX = "dep:";

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** BCP-47-ish locale code: primary subtag plus optional hyphen-joined subtags. */
const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

/** `<platform>-<arch>`, e.g. `windows-x64`. `universal` is macOS-only. */
export function isPluginBinaryPlatformKey(value) {
    const separator = typeof value === "string" ? value.lastIndexOf("-") : -1;
    if (separator <= 0) {
        return false;
    }
    const platform = value.slice(0, separator);
    const arch = value.slice(separator + 1);
    if (!BINARY_PLATFORMS.includes(platform) || !BINARY_ARCHS.includes(arch)) {
        return false;
    }
    return arch !== "universal" || platform === "macos";
}

/**
 * Registry-level categories. Kept small on purpose: a long tail of one-off
 * categories makes the future in-Studio browser worse, not better.
 */
export const PLUGIN_CATEGORIES = [
    "blueprint",
    "ui",
    "assets",
    "story",
    "workflow",
    "integration",
    "theme",
    "other",
];

export function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

/** Directory names under plugins/, sorted. Each must equal its plugin id. */
export function listPluginDirs() {
    if (!fs.existsSync(pluginsDir)) {
        return [];
    }
    return fs.readdirSync(pluginsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
        .map(entry => entry.name)
        .sort();
}

export function pluginDir(id) {
    return path.join(pluginsDir, id);
}

/** `narraleaf.quick-save@1.2.0` — the tag that triggers a release build. */
export function releaseTag(id, version) {
    return `${id}@${version}`;
}

/** `narraleaf.quick-save-1.2.0.zip` — the asset name published to that release. */
export function releaseAssetName(id, version) {
    return `${id}-${version}.zip`;
}

/**
 * Deterministic from (id, version) alone, which is why index.json can be
 * generated and reviewed in the same PR that bumps a version — before the tag
 * is pushed and the release exists.
 */
export function releaseDownloadUrl(id, version) {
    return `${REPOSITORY_URL}/releases/download/${encodeURIComponent(releaseTag(id, version))}/${releaseAssetName(id, version)}`;
}

export function releasePageUrl(id, version) {
    return `${REPOSITORY_URL}/releases/tag/${encodeURIComponent(releaseTag(id, version))}`;
}

/** Split `<plugin-id>@<version>` back apart. Returns null when malformed. */
export function parseReleaseTag(tag) {
    const at = tag.lastIndexOf("@");
    if (at <= 0 || at === tag.length - 1) {
        return null;
    }
    const id = tag.slice(0, at);
    const version = tag.slice(at + 1);
    if (!PLUGIN_ID_PATTERN.test(id) || !VERSION_PATTERN.test(version)) {
        return null;
    }
    return { id, version };
}

export function isValidPluginId(id) {
    return typeof id === "string" && PLUGIN_ID_PATTERN.test(id);
}

export function isValidVersion(version) {
    return typeof version === "string" && VERSION_PATTERN.test(version);
}

function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record, key) {
    const value = record[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Mirrors Studio's isSafeRelativeEntry: no absolute paths, no traversal. */
export function isSafeRelativeEntry(entry) {
    if (!entry || entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(entry)) {
        return false;
    }
    if (entry.includes("\0") || entry.includes("?") || entry.includes("#")) {
        return false;
    }
    const segments = entry.split(/[\\/]+/).filter(Boolean);
    return segments.length > 0 && segments.every(segment => segment !== "." && segment !== "..");
}

/** Returns the number of declared capabilities; pushes any problems onto `errors`. */
function validateRuntimeCapabilities(value, errors) {
    if (value === undefined) {
        return 0;
    }
    if (!Array.isArray(value)) {
        errors.push("contributes.runtimeCapabilities must be an array of capability strings");
        return 0;
    }
    for (const item of value) {
        const capability = typeof item === "string" ? item.trim() : "";
        if (!capability) {
            errors.push("contributes.runtimeCapabilities entries must be non-empty strings");
            continue;
        }
        if (!PLUGIN_RUNTIME_CAPABILITIES.includes(capability)) {
            errors.push(`unknown runtime capability: ${capability} (known: ${PLUGIN_RUNTIME_CAPABILITIES.join(", ")})`);
        }
    }
    return value.length;
}

/** Returns the declared dependency ids, which sidecar `dep:` includes resolve against. */
function validateBuildDependencies(value, pluginId, errors) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        errors.push("contributes.buildDependencies must be an array of dependency objects");
        return [];
    }
    const ids = [];
    for (const item of value) {
        if (!isRecord(item)) {
            errors.push("contributes.buildDependencies entries must be objects");
            continue;
        }
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id || (pluginId && !id.startsWith(`${pluginId}.`))) {
            errors.push(`build dependency id must be prefixed with the plugin id: ${String(item.id)}`);
            continue;
        }
        if (ids.includes(id)) {
            errors.push(`contributes.buildDependencies declares "${id}" more than once`);
        }
        ids.push(id);

        if (!isRecord(item.targets) || Object.keys(item.targets).length === 0) {
            errors.push(`build dependency "${id}" must declare at least one platform target`);
            continue;
        }
        for (const [platformKey, target] of Object.entries(item.targets)) {
            const where = `build dependency "${id}" target "${platformKey}"`;
            if (!isPluginBinaryPlatformKey(platformKey)) {
                errors.push(`${where} has an unsupported platform key (expected <windows|macos|linux>-<x64|arm64>, or macos-universal)`);
                continue;
            }
            if (!isRecord(target)) {
                errors.push(`${where} must be an object`);
                continue;
            }
            const url = typeof target.url === "string" ? target.url.trim() : "";
            let parsed = null;
            try {
                parsed = new URL(url);
            } catch {
                parsed = null;
            }
            if (!parsed) {
                errors.push(`${where} url must be an absolute URL`);
            } else if (parsed.protocol !== "https:") {
                // The digest would catch swapped bytes, but the failure mode
                // should be "cannot be attacked", not "attack detected late".
                errors.push(`${where} url must use https`);
            }
            if (!SHA256_PATTERN.test(typeof target.sha256 === "string" ? target.sha256.trim() : "")) {
                errors.push(`${where} must declare a valid sha256`);
            }
            const archive = target.archive ?? "zip";
            if (archive === "none") {
                const fileName = typeof target.fileName === "string" ? target.fileName.trim() : "";
                if (!fileName || !isSafeRelativeEntry(fileName)) {
                    errors.push(`${where} fileName must be a relative path inside the dependency directory`);
                }
                continue;
            }
            if (archive !== "zip") {
                errors.push(`${where} archive must be "zip" or "none"`);
                continue;
            }
            if (!isRecord(target.files) || Object.keys(target.files).length === 0) {
                errors.push(`${where} must map at least one archive path in "files"`);
                continue;
            }
            for (const [inner, out] of Object.entries(target.files)) {
                const destination = typeof out === "string" ? out.trim() : "";
                if (!inner.trim()) {
                    errors.push(`${where} files keys must be non-empty archive paths`);
                }
                if (!destination || !isSafeRelativeEntry(destination)) {
                    errors.push(`${where} files["${inner}"] must be a relative path inside the dependency directory`);
                }
            }
        }
    }
    return ids;
}

/** Returns the number of declared sidecars; pushes any problems onto `errors`. */
function validateSidecars(value, pluginId, dependencyIds, errors) {
    if (value === undefined) {
        return 0;
    }
    if (!Array.isArray(value)) {
        errors.push("contributes.sidecars must be an array of sidecar objects");
        return 0;
    }
    const seen = new Set();
    for (const item of value) {
        if (!isRecord(item)) {
            errors.push("contributes.sidecars entries must be objects");
            continue;
        }
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id || (pluginId && !id.startsWith(`${pluginId}.`))) {
            errors.push(`sidecar id must be prefixed with the plugin id: ${String(item.id)}`);
            continue;
        }
        if (seen.has(id)) {
            errors.push(`contributes.sidecars declares "${id}" more than once`);
        }
        seen.add(id);

        const kind = item.kind ?? SIDECAR_DEFAULTS.kind;
        if (kind !== "executable" && kind !== "node") {
            errors.push(`sidecar "${id}" kind must be "executable" or "node"`);
        }
        if ((item.transport ?? SIDECAR_DEFAULTS.transport) !== "stdio-jsonl") {
            errors.push(`sidecar "${id}" transport must be "stdio-jsonl"`);
        }
        const autostart = item.autostart ?? SIDECAR_DEFAULTS.autostart;
        if (autostart !== "onGameStart" && autostart !== "onRequest") {
            errors.push(`sidecar "${id}" autostart must be "onGameStart" or "onRequest"`);
        }
        for (const key of ["startupTimeoutMs", "shutdownTimeoutMs"]) {
            if (item[key] !== undefined && !(Number.isInteger(item[key]) && item[key] > 0)) {
                errors.push(`sidecar "${id}" ${key} must be a positive integer`);
            }
        }
        if (item.restart !== undefined) {
            if (!isRecord(item.restart)) {
                errors.push(`sidecar "${id}" restart must be an object`);
            } else {
                const { maxRetries, backoffMs } = item.restart;
                if (maxRetries !== undefined && !(Number.isInteger(maxRetries) && maxRetries >= 0)) {
                    errors.push(`sidecar "${id}" restart.maxRetries must be a non-negative integer`);
                }
                if (backoffMs !== undefined && !(Number.isInteger(backoffMs) && backoffMs > 0)) {
                    errors.push(`sidecar "${id}" restart.backoffMs must be a positive integer`);
                }
            }
        }

        if (!isRecord(item.targets) || Object.keys(item.targets).length === 0) {
            errors.push(`sidecar "${id}" must declare at least one platform target`);
            continue;
        }
        for (const [platformKey, target] of Object.entries(item.targets)) {
            const where = `sidecar "${id}" target "${platformKey}"`;
            if (!isPluginBinaryPlatformKey(platformKey)) {
                errors.push(`${where} has an unsupported platform key (expected <windows|macos|linux>-<x64|arm64>, or macos-universal)`);
                continue;
            }
            if (!isRecord(target)) {
                errors.push(`${where} must be an object`);
                continue;
            }
            const entry = typeof target.entry === "string" ? target.entry.trim() : "";
            if (!entry || !isSafeRelativeEntry(entry)) {
                errors.push(`${where} entry must be a relative path inside the package`);
            }
            if (!Array.isArray(target.include) || target.include.length === 0) {
                errors.push(`${where} must list the files it ships in "include"`);
                continue;
            }
            const packaged = [];
            for (const rawInclude of target.include) {
                const include = typeof rawInclude === "string" ? rawInclude.trim() : "";
                if (!include) {
                    errors.push(`${where} include entries must be non-empty strings`);
                    continue;
                }
                if (include.startsWith(DEP_INCLUDE_PREFIX)) {
                    const reference = include.slice(DEP_INCLUDE_PREFIX.length);
                    const separator = reference.indexOf("/");
                    const dependencyId = separator === -1 ? reference : reference.slice(0, separator);
                    const relative = separator === -1 ? "" : reference.slice(separator + 1);
                    if (!dependencyIds.includes(dependencyId)) {
                        errors.push(`${where} include references undeclared build dependency "${dependencyId}"`);
                    }
                    if (!relative || !isSafeRelativeEntry(relative)) {
                        errors.push(`${where} include "${include}" must name a path inside the dependency`);
                    }
                    continue;
                }
                if (!isSafeRelativeEntry(include)) {
                    errors.push(`${where} include "${include}" must be a relative path inside the package`);
                    continue;
                }
                packaged.push(include);
            }
            if (entry && !target.include.includes(entry)) {
                errors.push(`${where} entry "${entry}" must also appear in "include"`);
            }
            // Every package-relative include needs a digest. `dep:` entries are
            // pinned by the build dependency's own sha256 instead.
            if (!isRecord(target.sha256)) {
                errors.push(`${where} must declare sha256 digests for its shipped files`);
                continue;
            }
            for (const file of packaged) {
                const digest = typeof target.sha256[file] === "string" ? target.sha256[file].trim() : "";
                if (!SHA256_PATTERN.test(digest)) {
                    errors.push(`${where} is missing a valid sha256 for "${file}"`);
                }
            }
            const extra = Object.keys(target.sha256).filter(file => !packaged.includes(file));
            if (extra.length) {
                errors.push(`${where} declares sha256 for files it does not ship: ${extra.join(", ")}`);
            }
        }
    }
    return value.length;
}

/**
 * Port of Studio's validatePluginManifest.
 * Returns { ok: true, manifest } or { ok: false, errors: string[] }.
 */
export function validatePluginManifest(value) {
    const errors = [];
    if (!isRecord(value)) {
        return { ok: false, errors: ["manifest.json must be a JSON object"] };
    }

    if (value.manifestVersion !== PLUGIN_MANIFEST_VERSION) {
        errors.push(`manifestVersion must be exactly ${PLUGIN_MANIFEST_VERSION} (got ${JSON.stringify(value.manifestVersion)})`);
    }

    const id = readString(value, "id");
    if (!id || !PLUGIN_ID_PATTERN.test(id)) {
        errors.push("id must be namespaced lowercase, for example publisher.plugin-name");
    }

    if (!readString(value, "name")) {
        errors.push("name is required");
    }

    const version = readString(value, "version");
    if (!version || !VERSION_PATTERN.test(version)) {
        errors.push("version must be semver, for example 1.0.0");
    }

    const entries = value.entries;
    if (!isRecord(entries)) {
        errors.push("entries must be an object declaring at least one of: studio, runtime");
    } else {
        const unknown = Object.keys(entries).filter(key => !PLUGIN_ENTRY_TARGETS.includes(key));
        if (unknown.length) {
            errors.push(`unsupported entry target(s): ${unknown.join(", ")}`);
        }
        let declared = 0;
        for (const target of PLUGIN_ENTRY_TARGETS) {
            const raw = entries[target];
            if (raw === undefined) {
                continue;
            }
            const entry = typeof raw === "string" ? raw.trim() : "";
            if (!entry || !isSafeRelativeEntry(entry)) {
                errors.push(`entries.${target} must be a relative file path inside the plugin package`);
                continue;
            }
            declared += 1;
        }
        if (declared === 0 && !unknown.length) {
            errors.push("entries must declare at least one of: studio, runtime");
        }
    }

    if (value.contributes !== undefined) {
        if (!isRecord(value.contributes)) {
            errors.push("contributes must be an object");
        } else {
            const unknown = Object.keys(value.contributes).filter(key => !PLUGIN_CONTRIBUTES_KEYS.includes(key));
            if (unknown.length) {
                errors.push(`unsupported contributes key(s): ${unknown.join(", ")}`);
            }
            for (const key of PLUGIN_CONTRIBUTES_TYPE_KEYS) {
                const raw = value.contributes[key];
                if (raw === undefined) {
                    continue;
                }
                if (!Array.isArray(raw)) {
                    errors.push(`contributes.${key} must be an array of type strings`);
                    continue;
                }
                for (const item of raw) {
                    const type = typeof item === "string" ? item.trim() : "";
                    if (!type) {
                        errors.push(`contributes.${key} entries must be non-empty strings`);
                        continue;
                    }
                    if (id && !type.startsWith(`${id}.`)) {
                        errors.push(`contributes.${key} type must be prefixed with the plugin id: ${type}`);
                    }
                }
            }

            const locales = value.contributes.locales;
            if (locales !== undefined) {
                if (!Array.isArray(locales)) {
                    errors.push("contributes.locales must be an array of locale objects");
                } else {
                    const seen = new Set();
                    for (const item of locales) {
                        if (!isRecord(item)) {
                            errors.push("contributes.locales entries must be objects");
                            continue;
                        }
                        const code = typeof item.code === "string" ? item.code.trim() : "";
                        if (!code || !LOCALE_CODE_PATTERN.test(code)) {
                            errors.push(`contributes.locales entry has an invalid locale code: ${String(item.code)}`);
                            continue;
                        }
                        if (seen.has(code)) {
                            errors.push(`contributes.locales declares "${code}" more than once`);
                        }
                        seen.add(code);
                        const messages = typeof item.messages === "string" ? item.messages.trim() : "";
                        if (!messages || !isSafeRelativeEntry(messages)) {
                            errors.push(`contributes.locales["${code}"].messages must be a relative JSON file path inside the plugin package`);
                        }
                        if (item.dir !== undefined && item.dir !== "ltr" && item.dir !== "rtl") {
                            errors.push(`contributes.locales["${code}"].dir must be "ltr" or "rtl"`);
                        }
                    }
                }
            }

            const capabilities = validateRuntimeCapabilities(value.contributes.runtimeCapabilities, errors);
            // Build dependencies first: sidecar `dep:` includes resolve against them.
            const dependencyIds = validateBuildDependencies(value.contributes.buildDependencies, id, errors);
            const sidecars = validateSidecars(value.contributes.sidecars, id, dependencyIds, errors);

            // Capabilities and sidecars are powers of the *runtime* entry.
            // Declaring them without one asks the user to approve something
            // nothing can use.
            if (isRecord(entries) && typeof entries.runtime !== "string") {
                if (capabilities > 0) {
                    errors.push("contributes.runtimeCapabilities requires a runtime entry");
                }
                if (sidecars > 0) {
                    errors.push("contributes.sidecars requires a runtime entry");
                }
            }
        }
    }

    if (value.permissions !== undefined) {
        if (!Array.isArray(value.permissions)) {
            errors.push("permissions must be an array");
        } else {
            for (const permission of value.permissions) {
                if (!isRecord(permission)) {
                    errors.push("permission entries must be objects");
                    continue;
                }
                if (permission.kind === "filesystem") {
                    if (!readString(permission, "path")) {
                        errors.push("filesystem permission requires a non-empty path");
                    }
                    if (!["read", "write", "readwrite"].includes(permission.mode)) {
                        errors.push("filesystem permission mode must be read, write, or readwrite");
                    }
                    if (typeof permission.recursive !== "boolean") {
                        errors.push("filesystem permission requires a boolean recursive flag");
                    }
                    continue;
                }
                if (permission.kind === "api") {
                    if (!readString(permission, "capability")) {
                        errors.push("api permission requires a non-empty capability");
                    }
                    continue;
                }
                if (PLUGIN_DERIVED_PERMISSION_KINDS.includes(String(permission.kind))) {
                    errors.push(`permission kind "${String(permission.kind)}" is derived from contributes and must not be declared by hand`);
                    continue;
                }
                errors.push(`unsupported permission kind: ${JSON.stringify(permission.kind)}`);
            }
        }
    }

    if (errors.length) {
        return { ok: false, errors };
    }
    return { ok: true, manifest: value };
}

/**
 * Load one plugin's manifest.json + package.json, cross-check the two, and
 * return the shape the index generator consumes.
 */
export function loadPlugin(dirName, { root = pluginsDir } = {}) {
    const dir = path.join(root, dirName);
    const errors = [];
    const manifestPath = path.join(dir, "manifest.json");
    const packagePath = path.join(dir, "package.json");

    if (!fs.existsSync(manifestPath)) {
        return { dirName, dir, ok: false, errors: ["missing manifest.json"] };
    }
    if (!fs.existsSync(packagePath)) {
        return { dirName, dir, ok: false, errors: ["missing package.json"] };
    }

    let manifest;
    let pkg;
    try {
        manifest = readJson(manifestPath);
    } catch (error) {
        return { dirName, dir, ok: false, errors: [`manifest.json is not valid JSON: ${error.message}`] };
    }
    try {
        pkg = readJson(packagePath);
    } catch (error) {
        return { dirName, dir, ok: false, errors: [`package.json is not valid JSON: ${error.message}`] };
    }

    const result = validatePluginManifest(manifest);
    if (!result.ok) {
        errors.push(...result.errors.map(message => `manifest.json: ${message}`));
    }

    if (result.ok && manifest.id !== dirName && root === pluginsDir) {
        errors.push(`directory name must equal the plugin id (expected plugins/${manifest.id})`);
    }
    if (result.ok && pkg.version !== manifest.version) {
        errors.push(`package.json version (${pkg.version}) must equal manifest.json version (${manifest.version})`);
    }
    if (!pkg.scripts || typeof pkg.scripts.build !== "string") {
        errors.push("package.json must define a \"build\" script");
    }
    if (!pkg.license) {
        errors.push("package.json must declare a license");
    }

    const meta = pkg.narraleaf ?? {};
    if (!isRecord(meta)) {
        errors.push("package.json \"narraleaf\" must be an object");
    } else {
        const categories = meta.categories;
        if (!Array.isArray(categories) || categories.length === 0) {
            errors.push("package.json narraleaf.categories must be a non-empty array");
        } else {
            for (const category of categories) {
                if (!PLUGIN_CATEGORIES.includes(category)) {
                    errors.push(`unknown category ${JSON.stringify(category)} (allowed: ${PLUGIN_CATEGORIES.join(", ")})`);
                }
            }
        }
        if (meta.studioVersion !== undefined && typeof meta.studioVersion !== "string") {
            errors.push("package.json narraleaf.studioVersion must be a semver range string");
        }
    }

    // A committed lockfile is what makes a plugin reproducible for other
    // contributors and for the release runner.
    if (!fs.existsSync(path.join(dir, "yarn.lock"))) {
        errors.push("missing yarn.lock (commit it — each plugin resolves its own dependencies)");
    }

    if (errors.length) {
        return { dirName, dir, ok: false, errors };
    }

    return { dirName, dir, ok: true, manifest, pkg, meta };
}

/** Build the index.json entry for a validated plugin. */
export function toIndexEntry(plugin) {
    const { manifest, pkg, meta } = plugin;
    const entry = {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? pkg.description ?? "",
        publisher: manifest.publisher ?? "",
        path: `plugins/${manifest.id}`,
        targets: PLUGIN_ENTRY_TARGETS.filter(target => typeof manifest.entries?.[target] === "string"),
        categories: [...(meta.categories ?? [])],
        keywords: [...(pkg.keywords ?? [])],
        license: pkg.license,
        contributes: {
            blueprintNodes: [...(manifest.contributes?.blueprintNodes ?? [])],
            widgets: [...(manifest.contributes?.widgets ?? [])],
            locales: (manifest.contributes?.locales ?? []).map(locale => locale.code),
        },
        permissions: manifest.permissions ?? [],
        release: {
            tag: releaseTag(manifest.id, manifest.version),
            page: releasePageUrl(manifest.id, manifest.version),
            download: releaseDownloadUrl(manifest.id, manifest.version),
        },
    };

    if (meta.studioVersion) {
        entry.studioVersion = meta.studioVersion;
    }
    if (pkg.homepage) {
        entry.homepage = pkg.homepage;
    }
    if (meta.locales) {
        entry.locales = meta.locales;
    }
    return entry;
}

export function buildIndex(plugins) {
    return {
        $schema: "./schema/index.schema.json",
        formatVersion: INDEX_FORMAT_VERSION,
        repository: REPOSITORY_URL,
        plugins: plugins.map(toIndexEntry).sort((a, b) => a.id.localeCompare(b.id)),
    };
}
