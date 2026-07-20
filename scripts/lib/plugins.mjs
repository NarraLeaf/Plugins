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
export const PLUGIN_CONTRIBUTES_KEYS = ["blueprintNodes", "widgets"];

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

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
            for (const key of PLUGIN_CONTRIBUTES_KEYS) {
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
