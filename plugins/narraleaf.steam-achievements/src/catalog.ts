/**
 * The achievement catalog: the shape of the authored data, and the pure helpers
 * that read and check it. Shared by every entry — the studio entry (main.tsx)
 * owns editing, the node definitions (nodes.ts) read it in both the editor and
 * the game.
 *
 * Nothing here may import Studio internals. Plugin bundles only resolve
 * `narraleaf-studio/plugin` and `narraleaf-studio/runtime`, so shared vocabulary
 * (wire formats, storage keys) is spelled out literally.
 */

import { translateEnglish, type Translate } from "./i18n";

export const PLUGIN_ID = "narraleaf.steam-achievements";

/**
 * Plugin storage namespace holding the catalog. Declared in
 * `contributes.runtimeData`, which is what publishes it with the game — plugin
 * stores live under the project's `editor/` directory, which is never packaged.
 */
export const CATALOG_NAMESPACE = `${PLUGIN_ID}.catalog`;

/** The sidecar declared in `contributes.sidecars`. */
export const SIDECAR_ID = `${PLUGIN_ID}.bridge`;

/**
 * Local-mirror keys in `app.game.store`. The mirror is the source of truth for
 * every read node, so a game reads the same answers with Steam running, with
 * Steam absent, on itch, on the web export and in Dev Mode.
 */
export const STORE_KEY_UNLOCKED = `${PLUGIN_ID}.unlocked`;
export const STORE_KEY_STATS = `${PLUGIN_ID}.stats`;
export const STORE_KEY_PROGRESS = `${PLUGIN_ID}.progress`;

/**
 * Steam API Names (achievements and stats alike) are ASCII identifiers. The
 * backend silently truncates or rejects anything else, and the failure surfaces
 * as "the achievement never fires" months later — so it is an authoring error
 * here, not a runtime surprise.
 */
export const STEAM_API_NAME_PATTERN = /^[A-Za-z0-9_]{1,44}$/;

/**
 * Steam's third stat kind, average-rate, is deliberately absent. It is written
 * with `UpdateAvgRateStat(name, countThisSession, sessionLength)`, and no node
 * here has a session length to give — so an `avgrate` stat could only ever
 * reach the local mirror and would never once appear on Steam. Offering a type
 * that silently never syncs is worse than not offering it.
 */
export type SteamStatType = "int" | "float";

export type SteamStat = {
    id: string;
    type: SteamStatType;
    defaultValue: number;
    min?: number;
    max?: number;
    /** Reject writes that would lower the value. Steam has the same flag server-side. */
    incrementOnly?: boolean;
};

/**
 * One achievement: its Steam API Name, and nothing the author would have to type twice.
 *
 * The name, description, icons and hidden flag a player sees are set on the Steamworks partner
 * site, and Steam draws them from there. Version 0.1 asked for all of them here as well, per
 * language, plus a stat to drive progress - and none of it reached Steam or the game. Those
 * fields are no longer offered, but an entry that has them keeps them: they are the author's own
 * words, and the index signature carries them through every edit untouched.
 */
export type Achievement = {
    /** Steam API Name. Matches {@link STEAM_API_NAME_PATTERN}. */
    id: string;
    readonly [carried: string]: unknown;
};

export const CATALOG_VERSION = 1 as const;

export type AchievementCatalog = {
    version: typeof CATALOG_VERSION;
    /**
     * Steam App ID. Handed to the sidecar on connect, which publishes it to
     * `SteamAPI_Init` — the author never places `steam_appid.txt` anywhere. An
     * App ID inherited from Steam's own launch environment still wins over this.
     */
    appId?: string;
    achievements: Achievement[];
    stats: SteamStat[];
};

export function emptyCatalog(): AchievementCatalog {
    return {
        version: CATALOG_VERSION,
        achievements: [],
        stats: [],
    };
}

function readRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function readTrimmed(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
}

function readFiniteNumber(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeStat(raw: unknown): SteamStat | null {
    const record = readRecord(raw);
    const id = record ? readTrimmed(record.id) : "";
    if (!record || !id) {
        return null;
    }
    // A catalog authored before avgrate was withdrawn degrades to `float`, not
    // `int`: an average-rate value is fractional, and truncating it would lose
    // data the mirror already holds.
    const type: SteamStatType = record.type === "float" || record.type === "avgrate" ? "float" : "int";
    const stat: SteamStat = {
        id,
        type,
        defaultValue: readFiniteNumber(record.defaultValue, 0),
    };
    if (typeof record.min === "number" && Number.isFinite(record.min)) {
        stat.min = record.min;
    }
    if (typeof record.max === "number" && Number.isFinite(record.max)) {
        stat.max = record.max;
    }
    if (record.incrementOnly === true) {
        stat.incrementOnly = true;
    }
    return stat;
}

function normalizeAchievement(raw: unknown): Achievement | null {
    const record = readRecord(raw);
    const id = record ? readTrimmed(record.id) : "";
    if (!record || !id) {
        return null;
    }
    return { ...record, id };
}

/**
 * The progress maximum a version 0.1 catalog stored on the achievement, if any.
 *
 * `Indicate Achievement Progress` fell back to it when its `Max` pin was left empty, and a graph
 * written then still relies on that; the node keeps reading it so those graphs go on drawing
 * their toast.
 */
export function carriedProgressMax(achievement: Achievement | null): number | null {
    const progress = achievement ? readRecord(achievement.progress) : null;
    const max = progress ? progress.max : undefined;
    return typeof max === "number" && Number.isFinite(max) && max > 0 ? max : null;
}

/**
 * Coerce untrusted stored data into a well-formed catalog. Never throws: a
 * corrupt catalog degrades to fewer entries rather than breaking the panel
 * or a running game.
 */
export function normalizeCatalog(value: unknown): AchievementCatalog {
    const record = readRecord(value);
    if (!record) {
        return emptyCatalog();
    }
    const catalog: AchievementCatalog = {
        version: CATALOG_VERSION,
        achievements: Array.isArray(record.achievements)
            ? record.achievements
                .map(normalizeAchievement)
                .filter((item): item is Achievement => item !== null)
            : [],
        stats: Array.isArray(record.stats)
            ? record.stats.map(normalizeStat).filter((item): item is SteamStat => item !== null)
            : [],
    };
    const appId = readTrimmed(record.appId);
    if (appId) {
        catalog.appId = appId;
    }
    return catalog;
}

export function findAchievement(catalog: AchievementCatalog, id: string): Achievement | null {
    const wanted = id.trim();
    return wanted ? catalog.achievements.find(item => item.id === wanted) ?? null : null;
}

export function findStat(catalog: AchievementCatalog, id: string): SteamStat | null {
    const wanted = id.trim();
    return wanted ? catalog.stats.find(item => item.id === wanted) ?? null : null;
}

export type CatalogIssueSeverity = "error" | "warning";

export type CatalogIssue = {
    severity: CatalogIssueSeverity;
    /** Achievement or stat id the issue belongs to; absent for catalog-wide issues. */
    subjectId?: string;
    message: string;
};

/**
 * Author-time checks.
 *
 * Errors are names Steam will reject, or that two entries share. The one warning
 * is achievements with no App ID: that ships, but a copy of the game started
 * outside Steam cannot reach it.
 *
 * `t` words the messages; the panel passes its translator, so they read in
 * the editor's language.
 */
export function validateCatalog(catalog: AchievementCatalog, t: Translate = translateEnglish): CatalogIssue[] {
    const issues: CatalogIssue[] = [];
    const seenAchievements = new Set<string>();
    const seenStats = new Set<string>();

    for (const stat of catalog.stats) {
        if (!STEAM_API_NAME_PATTERN.test(stat.id)) {
            issues.push({
                severity: "error",
                subjectId: stat.id,
                message: t("issue.statApiName", { id: stat.id }),
            });
        }
        if (seenStats.has(stat.id)) {
            issues.push({ severity: "error", subjectId: stat.id, message: t("issue.statDuplicate", { id: stat.id }) });
        }
        seenStats.add(stat.id);
        if (stat.min !== undefined && stat.max !== undefined && stat.min > stat.max) {
            issues.push({ severity: "error", subjectId: stat.id, message: t("issue.statRange", { id: stat.id }) });
        }
    }

    for (const achievement of catalog.achievements) {
        if (!STEAM_API_NAME_PATTERN.test(achievement.id)) {
            issues.push({
                severity: "error",
                subjectId: achievement.id,
                message: t("issue.apiName", { id: achievement.id }),
            });
        }
        if (seenAchievements.has(achievement.id)) {
            issues.push({
                severity: "error",
                subjectId: achievement.id,
                message: t("issue.duplicate", { id: achievement.id }),
            });
        }
        seenAchievements.add(achievement.id);
    }

    if (catalog.achievements.length > 0 && !catalog.appId) {
        issues.push({ severity: "warning", message: t("issue.noAppId") });
    }

    return issues;
}

/** Group issues by the achievement or stat they belong to, for inline display. */
export function issuesBySubject(issues: CatalogIssue[]): Map<string, CatalogIssue[]> {
    const bySubject = new Map<string, CatalogIssue[]>();
    for (const issue of issues) {
        if (!issue.subjectId) {
            continue;
        }
        const bucket = bySubject.get(issue.subjectId);
        if (bucket) {
            bucket.push(issue);
        } else {
            bySubject.set(issue.subjectId, [issue]);
        }
    }
    return bySubject;
}

/** Clamp a stat write to the bounds the catalog declares. */
export function clampStatValue(stat: SteamStat | null, previous: number, next: number): number {
    let value = next;
    if (stat?.incrementOnly && value < previous) {
        value = previous;
    }
    if (stat && typeof stat.min === "number" && value < stat.min) {
        value = stat.min;
    }
    if (stat && typeof stat.max === "number" && value > stat.max) {
        value = stat.max;
    }
    return stat?.type === "int" ? Math.trunc(value) : value;
}
