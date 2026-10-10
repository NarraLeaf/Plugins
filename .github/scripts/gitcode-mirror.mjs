#!/usr/bin/env node
/**
 * Keep the GitCode copy of a NarraLeaf registry repository in step with GitHub.
 *
 *   node .github/scripts/gitcode-mirror.mjs sync   [--branch master] [--token-file <file>]
 *   node .github/scripts/gitcode-mirror.mjs verify [--branch master]
 *
 * The same file sits in NarraLeaf/Plugins, NarraLeaf/UI-Templates and NarraLeaf/Dictionaries. It
 * works out which store it serves from the shape of the repository's `index.json`.
 *
 * Why the copy exists: NarraLeaf Studio's plugin store, template store and dictionary download read
 * these repositories, and GitHub is unreachable or crawls from much of mainland China. Studio ships
 * GitCode (https://gitcode.com/NarraLeaf) as a second built-in source and maps every address a
 * catalogue carries onto it by one fixed rule, `gitCodeUrlFor` below. That rule is duplicated from
 * Studio's `src/shared/utils/storeMirror.ts`; a change to one is a change to both.
 *
 * `sync` (needs a GitCode token):
 *   1. creates the GitCode repository under the NarraLeaf organisation if it is missing;
 *   2. pushes every tag. Tags are pushed first because a GitCode release needs its tag, and the
 *      catalogue does not move with them - Studio reads `index.json` from the branch;
 *   3. for every GitHub release, makes the GitCode release of the same tag and uploads the files
 *      GitCode does not have yet (the plugin zips);
 *   4. pushes the branch, but only once GitCode serves every package the branch's `index.json`
 *      names. When a release is not published yet - the branch is pushed a moment before the tag in
 *      the normal release flow - the branch waits, and the run that follows the release pushes it.
 *      So the GitCode catalogue never points at a package GitCode does not have.
 *
 * `verify` (no token): reads the GitCode catalogue the way Studio does and checks that every file it
 * names is served and is the same file GitHub serves. Safe to run from any machine.
 *
 * Re-running either is safe: what is already there is left alone. The token comes from
 * GITCODE_TOKEN or --token-file (one line; lines starting with # are ignored), is sent only to
 * api.gitcode.com and gitcode.com, and is never printed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const OWNER = "NarraLeaf";
const GITCODE_API = process.env.GITCODE_API_URL || "https://api.gitcode.com/api/v5";
const GITCODE_SITE = process.env.GITCODE_SITE_URL || "https://gitcode.com";
const GITHUB_API = "https://api.github.com";
/** The registry repositories GitCode carries in full. Keys are lower-cased for matching. */
const MIRRORED_REPOSITORIES = new Map([
    ["plugins", "Plugins"],
    ["ui-templates", "UI-Templates"],
    ["dictionaries", "Dictionaries"],
]);
const REQUEST_TIMEOUT_MS = 60_000;
const UPLOAD_ATTEMPTS = 3;

// ---------------------------------------------------------------------------------------------
// The address rule. Keep identical to Studio's src/shared/utils/storeMirror.ts.
// ---------------------------------------------------------------------------------------------

/** encodeURIComponent, except `@`, which a path segment may carry as it is (RFC 3986 pchar). */
function encodeSegment(value) {
    return encodeURIComponent(value).replace(/%40/g, "@");
}

function decodeSegment(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/**
 * Where GitCode serves the file a GitHub address names, or the address unchanged when it is not a
 * file of a mirrored repository.
 *
 * - `raw.githubusercontent.com/NarraLeaf/<repo>/<ref>/<path>` (and `github.com/.../raw/<ref>/<path>`)
 *   becomes GitCode's raw-file API, `api.gitcode.com/api/v5/repos/NarraLeaf/<repo>/raw/<path>?ref=<ref>`.
 *   Not `raw.gitcode.com`: that host answers some files with 403 "暂不支持预览" and redirects images
 *   and archives to a placeholder picture, while the API serves the bytes of every file.
 * - `github.com/NarraLeaf/<repo>/releases/download/<tag>/<file>` becomes the same path on gitcode.com.
 * - `github.com/NarraLeaf/<repo>/releases/tag/<tag>` becomes `gitcode.com/NarraLeaf/<repo>/releases/<tag>`.
 */
export function gitCodeUrlFor(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return url;
    }
    if (parsed.protocol !== "https:") {
        return url;
    }
    const segments = parsed.pathname.split("/").slice(1);
    if (segments.length < 3 || segments[0].toLowerCase() !== OWNER.toLowerCase()) {
        return url;
    }
    const repo = MIRRORED_REPOSITORIES.get(segments[1].toLowerCase());
    if (!repo) {
        return url;
    }
    const host = parsed.hostname.toLowerCase();
    const rest = segments.slice(2);
    const rawFile = (ref, pathSegments) => {
        if (!ref || pathSegments.length === 0 || pathSegments.some(segment => segment === "")) {
            return url;
        }
        return `https://api.gitcode.com/api/v5/repos/${OWNER}/${repo}/raw/${pathSegments.join("/")}?ref=${encodeURIComponent(decodeSegment(ref))}`;
    };
    if (host === "raw.githubusercontent.com") {
        return rawFile(rest[0], rest.slice(1));
    }
    if (host !== "github.com" && host !== "www.github.com") {
        return url;
    }
    if (rest[0] === "raw") {
        return rawFile(rest[1], rest.slice(2));
    }
    if (rest[0] === "releases" && rest[1] === "download" && rest.length === 4 && rest[2] && rest[3]) {
        return `${GITCODE_SITE}/${OWNER}/${repo}/releases/download/${encodeSegment(decodeSegment(rest[2]))}/${rest[3]}`;
    }
    if (rest[0] === "releases" && rest[1] === "tag" && rest.length === 3 && rest[2]) {
        return `${GITCODE_SITE}/${OWNER}/${repo}/releases/${encodeSegment(decodeSegment(rest[2]))}`;
    }
    return url;
}

// ---------------------------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------------------------

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const args = { command };
    for (let index = 0; index < rest.length; index += 1) {
        const key = rest[index];
        if (!key.startsWith("--")) {
            throw new Error(`Unexpected argument ${key}`);
        }
        args[key.slice(2)] = rest[index + 1];
        index += 1;
    }
    return args;
}

function readToken(args) {
    if (args["token-file"]) {
        const lines = fs.readFileSync(args["token-file"], "utf8")
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#"));
        if (lines.length !== 1) {
            throw new Error(`${args["token-file"]} should hold exactly one token line.`);
        }
        return lines[0];
    }
    if (process.env.GITCODE_TOKEN?.trim()) {
        return process.env.GITCODE_TOKEN.trim();
    }
    throw new Error("No GitCode token: set the GITCODE_TOKEN secret (organisation secret, shared with this repository) or pass --token-file.");
}

/** `owner/name` of the GitHub repository being mirrored. */
function githubRepository(args) {
    const full = args.repo || process.env.GITHUB_REPOSITORY;
    if (!full || !/^[^/]+\/[^/]+$/.test(full)) {
        throw new Error("Pass --repo NarraLeaf/<name>, or run inside GitHub Actions.");
    }
    const [owner, name] = full.split("/");
    if (owner.toLowerCase() !== OWNER.toLowerCase() || !MIRRORED_REPOSITORIES.has(name.toLowerCase())) {
        throw new Error(`${full} is not one of the registry repositories GitCode mirrors.`);
    }
    return { owner: OWNER, name: MIRRORED_REPOSITORIES.get(name.toLowerCase()) };
}

function gitcodeApi(token) {
    return async (method, route, body) => {
        const response = await fetch(`${GITCODE_API}${route}`, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const text = await response.text();
        let json = null;
        try {
            json = text ? JSON.parse(text) : null;
        } catch {
            // Reported with the status by the caller.
        }
        return { status: response.status, json, text };
    };
}

async function githubJson(route) {
    const headers = { Accept: "application/vnd.github+json" };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(`${GITHUB_API}${route}`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
        throw new Error(`GitHub answered ${response.status} to ${route}`);
    }
    return response.json();
}

async function fetchBytes(url, init = {}) {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { status: response.status, bytes: null, type: response.headers.get("content-type") ?? "" };
    }
    return {
        status: response.status,
        bytes: Buffer.from(await response.arrayBuffer()),
        type: response.headers.get("content-type") ?? "",
    };
}

function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}

function git(args, options = {}) {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

function formatSize(bytes) {
    return bytes >= 1 << 20 ? `${(bytes / (1 << 20)).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** The total size GitCode serves at a release download address, or null when it serves nothing there. */
async function servedSize(url) {
    try {
        const response = await fetch(url, { headers: { Range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        await response.body?.cancel().catch(() => undefined);
        if (response.status === 206) {
            const total = /\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
            return total ? Number(total[1]) : null;
        }
        if (response.status === 200) {
            const length = response.headers.get("content-length");
            return length === null ? null : Number(length);
        }
        return null;
    } catch {
        return null;
    }
}

/** `servedSize` a few times over a minute: GitCode lists a file a moment after its upload ends. */
async function settledSize(url, expected) {
    let served = null;
    for (let check = 0; check < 6; check += 1) {
        served = await servedSize(url);
        if (served === expected) {
            return served;
        }
        await sleep(10_000);
    }
    return served;
}

// ---------------------------------------------------------------------------------------------
// What a catalogue names
// ---------------------------------------------------------------------------------------------

/** Which store an index is the catalogue of, from its shape. */
function storeKind(index) {
    if (Array.isArray(index?.plugins)) {
        return "plugins";
    }
    if (Array.isArray(index?.templates)) {
        return "templates";
    }
    if (Array.isArray(index?.dictionaries)) {
        return "dictionaries";
    }
    throw new Error("index.json is not a plugin, template or dictionary catalogue.");
}

function rawUrl(repository, ref, filePath) {
    return `https://raw.githubusercontent.com/${repository.owner}/${repository.name}/${ref}/${filePath.split("/").map(encodeURIComponent).join("/")}`;
}

function joinPath(...parts) {
    return parts
        .filter(part => typeof part === "string" && part.length > 0)
        .map(part => part.replace(/^\/+|\/+$/g, ""))
        .join("/");
}

/**
 * Every file a catalogue names, as the GitHub address Studio starts from, with what is known about
 * it in advance: a dictionary carries its digest, a plugin package is compared with the GitHub
 * release's size, and anything else is compared byte for byte with GitHub's copy.
 */
function namedFiles(index, repository, ref) {
    const files = [];
    switch (storeKind(index)) {
        case "plugins":
            for (const plugin of index.plugins) {
                if (plugin?.release?.download) {
                    files.push({ label: `${plugin.id} package`, url: plugin.release.download, kind: "release" });
                }
                if (plugin?.icon) {
                    files.push({ label: `${plugin.id} icon`, url: plugin.icon, kind: "raw" });
                }
            }
            break;
        case "templates":
            for (const theme of index.themes ?? []) {
                if (theme?.path && theme.preview) {
                    files.push({ label: `${theme.id} poster`, url: rawUrl(repository, ref, joinPath(theme.path, theme.preview)), kind: "raw" });
                }
            }
            for (const template of index.templates) {
                for (const file of [template.document, template.graphs, template.preview]) {
                    if (template?.path && file) {
                        files.push({ label: `${template.id} ${file}`, url: rawUrl(repository, ref, joinPath(template.path, file)), kind: "raw" });
                    }
                }
                for (const asset of template.assets ?? []) {
                    if (template?.path && asset?.path) {
                        files.push({ label: `${template.id} ${asset.path}`, url: rawUrl(repository, ref, joinPath(template.path, asset.path)), kind: "raw" });
                    }
                }
            }
            break;
        case "dictionaries":
            for (const dictionary of index.dictionaries) {
                if (dictionary?.download) {
                    files.push({ label: `${dictionary.code} dictionary`, url: dictionary.download, kind: "raw", sha256: dictionary.sha256 });
                }
            }
            break;
    }
    return files;
}

// ---------------------------------------------------------------------------------------------
// sync
// ---------------------------------------------------------------------------------------------

async function ensureRepository(call, repository) {
    const existing = await call("GET", `/repos/${OWNER}/${repository.name}`);
    if (existing.status === 200) {
        if (existing.json?.private === true) {
            throw new Error(`${GITCODE_SITE}/${OWNER}/${repository.name} is private. Studio reads it without signing in, so it has to be public.`);
        }
        return;
    }
    if (existing.status !== 404) {
        throw new Error(`Reading ${OWNER}/${repository.name} on GitCode answered ${existing.status}: ${existing.text.slice(0, 300)}`);
    }
    console.log(`Creating ${GITCODE_SITE}/${OWNER}/${repository.name}.`);
    const created = await call("POST", `/orgs/${OWNER}/repos`, {
        name: repository.name,
        path: repository.name,
        description: `Mirror of https://github.com/${repository.owner}/${repository.name} for NarraLeaf Studio. GitHub 仓库的镜像，供 NarraLeaf Studio 在无法顺畅访问 GitHub 时使用。`,
        homepage: `https://github.com/${repository.owner}/${repository.name}`,
        has_issues: false,
        has_wiki: false,
        private: false,
        auto_init: false,
    });
    if (created.status < 200 || created.status >= 300) {
        throw new Error(`Creating ${OWNER}/${repository.name} on GitCode answered ${created.status}: ${created.text.slice(0, 500)}`);
    }
}

/** The GitCode account the token belongs to; git over HTTPS signs in with it. */
async function gitcodeLogin(call) {
    const user = await call("GET", "/user");
    const login = user.json?.login;
    if (user.status !== 200 || typeof login !== "string" || !login) {
        throw new Error(`GitCode did not say whose token this is (answered ${user.status}). The token may have expired.`);
    }
    return login;
}

/**
 * Push refs to the GitCode repository. The credentials travel in a header for this one command, so
 * they are never written to .git/config and never appear in a remote URL git might print.
 */
function pushRefs(repository, login, token, refspecs) {
    const basic = Buffer.from(`${login}:${token}`).toString("base64");
    if (process.env.GITHUB_ACTIONS) {
        console.log(`::add-mask::${basic}`);
    }
    const remote = `${GITCODE_SITE}/${OWNER}/${repository.name}.git`;
    try {
        const output = execFileSync("git", [
            "-c", `http.${GITCODE_SITE}/.extraheader=AUTHORIZATION: basic ${basic}`,
            "push", "--porcelain", remote, ...refspecs,
        ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        return output;
    } catch (error) {
        const detail = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.replaceAll(basic, "***").trim();
        throw new Error(`git push to GitCode failed:\n${detail}`);
    }
}

async function listGitHubReleases(repository) {
    const releases = [];
    for (let page = 1; ; page += 1) {
        const batch = await githubJson(`/repos/${repository.owner}/${repository.name}/releases?per_page=100&page=${page}`);
        releases.push(...batch.filter(release => !release.draft));
        if (batch.length < 100) {
            return releases;
        }
    }
}

function releaseDownloadOnGitCode(repository, tag, name) {
    return `${GITCODE_SITE}/${OWNER}/${repository.name}/releases/download/${encodeSegment(tag)}/${encodeURIComponent(name)}`;
}

async function findGitCodeRelease(call, repository, tag) {
    const answer = await call("GET", `/repos/${OWNER}/${repository.name}/releases/tags/${encodeSegment(tag)}`);
    if (answer.status === 200 && answer.json) {
        return answer.json;
    }
    if (answer.status === 404 || (answer.status === 400 && /release/i.test(answer.text))) {
        return null;
    }
    throw new Error(`Reading the ${tag} release on GitCode answered ${answer.status}: ${answer.text.slice(0, 300)}`);
}

async function mirrorRelease(call, repository, release) {
    const tag = release.tag_name;
    const assets = release.assets ?? [];
    if (!(await findGitCodeRelease(call, repository, tag))) {
        console.log(`Creating the ${tag} release on GitCode.`);
        let commit = "";
        try {
            commit = git(["rev-list", "-n", "1", `refs/tags/${tag}`]);
        } catch {
            throw new Error(`Tag ${tag} is not in this checkout, so its GitCode release cannot be made.`);
        }
        const created = await call("POST", `/repos/${OWNER}/${repository.name}/releases`, {
            tag_name: tag,
            name: release.name || tag,
            body: `与 GitHub 上的同名发行版是同一批文件，供无法顺畅访问 GitHub 时下载：${release.html_url}\n\nThe same files as the GitHub release of the same name: ${release.html_url}`,
            target_commitish: commit,
        });
        if (created.status < 200 || created.status >= 300) {
            const hint = tag.includes("@") ? " The tag name contains `@`; if GitCode refuses it, that is the cause." : "";
            throw new Error(`Creating the ${tag} release on GitCode answered ${created.status}: ${created.text.slice(0, 500)}${hint}`);
        }
    }

    for (const asset of assets) {
        const target = releaseDownloadOnGitCode(repository, tag, asset.name);
        const already = await servedSize(target);
        if (already === asset.size) {
            continue;
        }
        if (already !== null) {
            throw new Error(`${tag}/${asset.name} is on GitCode at ${already} bytes, not ${asset.size}. Delete it from ${GITCODE_SITE}/${OWNER}/${repository.name}/releases and run this again.`);
        }
        const download = await fetchBytes(asset.browser_download_url);
        if (!download.bytes || download.bytes.length !== asset.size) {
            throw new Error(`Downloading ${tag}/${asset.name} from GitHub failed (${download.status}).`);
        }
        let done = false;
        for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS && !done; attempt += 1) {
            const address = await call("GET", `/repos/${OWNER}/${repository.name}/releases/${encodeSegment(tag)}/upload_url?file_name=${encodeURIComponent(asset.name)}`);
            if (!address.json?.url) {
                console.log(`  ${tag}/${asset.name}: no upload address (answered ${address.status}), attempt ${attempt}/${UPLOAD_ATTEMPTS}`);
                continue;
            }
            const put = await fetch(address.json.url, {
                method: "PUT",
                // A Buffer body gives the request the Content-Length the storage behind GitCode insists on.
                headers: address.json.headers ?? {},
                body: download.bytes,
                signal: AbortSignal.timeout(10 * 60_000),
            }).catch(error => ({ ok: false, status: 0, statusText: error.message }));
            if (!put.ok) {
                console.log(`  ${tag}/${asset.name}: upload answered ${put.status} ${put.statusText}, attempt ${attempt}/${UPLOAD_ATTEMPTS}`);
                continue;
            }
            const served = await settledSize(target, asset.size);
            if (served !== asset.size) {
                console.log(`  ${tag}/${asset.name}: GitCode serves ${served ?? "nothing"} after the upload, expected ${asset.size}, attempt ${attempt}/${UPLOAD_ATTEMPTS}`);
                continue;
            }
            console.log(`+ ${tag}/${asset.name} (${formatSize(asset.size)})`);
            done = true;
        }
        if (!done) {
            throw new Error(`${tag}/${asset.name} did not reach GitCode after ${UPLOAD_ATTEMPTS} attempts.`);
        }
    }
}

/**
 * The packages a branch's catalogue names that GitCode does not serve yet. Only plugin packages can
 * be missing: every other file a catalogue names is in the same commit as the catalogue, so the push
 * that brings one brings the other.
 */
async function missingPackages(index, repository, ref) {
    const missing = [];
    for (const file of namedFiles(index, repository, ref)) {
        if (file.kind !== "release") {
            continue;
        }
        if ((await servedSize(gitCodeUrlFor(file.url))) === null) {
            missing.push(file.label);
        }
    }
    return missing;
}

async function sync(args) {
    const repository = githubRepository(args);
    const branch = args.branch || "master";
    const token = readToken(args);
    const call = gitcodeApi(token);

    await ensureRepository(call, repository);
    const login = await gitcodeLogin(call);

    const tags = git(["tag", "--list"]).split("\n").filter(Boolean);
    if (tags.length > 0) {
        console.log(`Pushing ${tags.length} tag(s).`);
        try {
            pushRefs(repository, login, token, ["refs/tags/*:refs/tags/*"]);
        } catch (error) {
            const atTags = tags.filter(tag => tag.includes("@"));
            const hint = atTags.length > 0 && /@/.test(error.message)
                ? "\nGitCode may be refusing tag names that contain `@` (this repository's tags are <id>@<version>)."
                : "";
            throw new Error(`${error.message}${hint}`);
        }
    }

    const releases = await listGitHubReleases(repository);
    for (const release of releases) {
        await mirrorRelease(call, repository, release);
    }

    const commit = git(["rev-parse", `refs/remotes/origin/${branch}`]);
    const index = JSON.parse(git(["show", `${commit}:index.json`], { maxBuffer: 64 * 1024 * 1024 }));
    const missing = await missingPackages(index, repository, branch);
    if (missing.length > 0) {
        console.log(`::warning::${branch} was not pushed to GitCode: its index.json names packages GitCode does not have yet (${missing.join(", ")}). The run after their release is published pushes it.`);
        return;
    }
    console.log(`Pushing ${branch} (${commit.slice(0, 12)}).`);
    pushRefs(repository, login, token, [`+${commit}:refs/heads/${branch}`]);
    console.log(`${repository.name} is on GitCode: ${GITCODE_SITE}/${OWNER}/${repository.name}`);
}

// ---------------------------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------------------------

/** A file read a few times over half a minute: GitCode serves a push a moment after it lands. */
async function readSettled(url) {
    let last = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        last = await fetchBytes(url).catch(error => ({ status: 0, bytes: null, type: "", error: error.message }));
        if (last.bytes) {
            return last;
        }
        await sleep(8_000);
    }
    return last;
}

async function verify(args) {
    const repository = githubRepository(args);
    const branch = args.branch || "master";
    const githubIndexUrl = rawUrl(repository, branch, "index.json");
    const gitcodeIndexUrl = gitCodeUrlFor(githubIndexUrl);

    const failures = [];
    const report = (ok, label, detail) => {
        console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` - ${detail}` : ""}`);
        if (!ok) {
            failures.push(label);
        }
    };

    const gitcodeIndex = await readSettled(gitcodeIndexUrl);
    if (!gitcodeIndex?.bytes) {
        report(false, "catalogue", `${gitcodeIndexUrl} answered ${gitcodeIndex?.status ?? "nothing"}`);
        process.exitCode = 1;
        return;
    }
    let index;
    try {
        index = JSON.parse(gitcodeIndex.bytes.toString("utf8"));
        storeKind(index);
    } catch (error) {
        report(false, "catalogue", `${gitcodeIndexUrl} is not a catalogue: ${error.message}`);
        process.exitCode = 1;
        return;
    }
    report(true, "catalogue", gitcodeIndexUrl);

    const githubIndex = await fetchBytes(githubIndexUrl).catch(() => null);
    if (githubIndex?.bytes && sha256(githubIndex.bytes) !== sha256(gitcodeIndex.bytes)) {
        console.log(`note GitCode's index.json differs from GitHub's ${branch}; GitCode has not caught up with the latest push yet.`);
    }

    // Release sizes, for the plugin packages; read once.
    const releaseSizes = new Map();
    if (storeKind(index) === "plugins") {
        for (const release of await listGitHubReleases(repository)) {
            for (const asset of release.assets ?? []) {
                releaseSizes.set(`${release.tag_name}/${asset.name}`, asset.size);
            }
        }
    }

    for (const file of namedFiles(index, repository, branch)) {
        const mapped = gitCodeUrlFor(file.url);
        if (mapped === file.url) {
            report(false, file.label, `${file.url} is not an address the GitCode rule maps`);
            continue;
        }
        if (file.kind === "release") {
            const parts = new URL(file.url).pathname.split("/");
            const key = `${decodeSegment(parts[parts.length - 2])}/${decodeSegment(parts[parts.length - 1])}`;
            const expected = releaseSizes.get(key);
            const served = await servedSize(mapped);
            report(served !== null && (expected === undefined || served === expected), file.label,
                `${mapped} serves ${served ?? "nothing"}${expected === undefined ? "" : `, GitHub ${expected}`}`);
            continue;
        }
        const served = await readSettled(mapped);
        if (!served?.bytes) {
            report(false, file.label, `${mapped} answered ${served?.status ?? "nothing"}`);
            continue;
        }
        if (file.sha256) {
            const digest = sha256(served.bytes);
            report(digest === file.sha256, file.label, `${mapped} ${formatSize(served.bytes.length)}, sha256 ${digest === file.sha256 ? "matches" : `is ${digest}, index says ${file.sha256}`}`);
            continue;
        }
        const original = await fetchBytes(file.url).catch(() => null);
        if (!original?.bytes) {
            report(true, file.label, `${mapped} ${formatSize(served.bytes.length)} (GitHub copy unreadable, not compared)`);
            continue;
        }
        const same = sha256(original.bytes) === sha256(served.bytes);
        report(same, file.label, `${mapped} ${formatSize(served.bytes.length)}${same ? ", same bytes as GitHub" : `, differs from GitHub (${formatSize(original.bytes.length)}, ${served.type})`}`);
    }

    if (failures.length > 0) {
        console.log(`::error::${failures.length} file(s) the GitCode catalogue names are not served correctly by GitCode.`);
        process.exitCode = 1;
    } else {
        console.log("Every file the GitCode catalogue names is served by GitCode.");
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === "sync") {
        await sync(args);
    } else if (args.command === "verify") {
        await verify(args);
    } else {
        throw new Error("Usage: gitcode-mirror.mjs sync|verify [--branch master] [--repo NarraLeaf/<name>] [--token-file <file>]");
    }
}

// Run only as a script, so the address rule can be imported by a test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch(error => {
        console.error(`::error::${error.message}`);
        process.exitCode = 1;
    });
}
