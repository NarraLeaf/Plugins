/**
 * The achievement catalog: the shape of the authored data, and the pure helpers
 * that read and check it. Shared by every entry — the studio entry (main.tsx)
 * owns editing, the node definitions (nodes.ts) read it in both the editor and
 * the game.
 *
 * Nothing here may import Studio internals. Plugin bundles only resolve
 * `narraleaf-studio/plugin` and `narraleaf-studio/runtime`, so shared vocabulary
 * (locale codes, wire formats) is spelled out literally.
 */

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

/** An editor locale code, e.g. `en` or `zh-CN`. */
export type LocaleCode = string;

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

export type Achievement = {
    /** Steam API Name. Matches {@link STEAM_API_NAME_PATTERN}. */
    id: string;
    name: Record<LocaleCode, string>;
    description: Record<LocaleCode, string>;
    hidden: boolean;
    /** Asset library ids; used by the Steamworks backend export, not by the game. */
    iconAchievedAssetId?: string;
    iconUnachievedAssetId?: string;
    /** Turns this into a progress achievement: `Indicate Achievement Progress` drives the "3/10" toast. */
    progress?: { statId: string; max: number };
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
    /**
     * Languages the achievement text is authored in.
     *
     * Authored here rather than read from the project because the studio plugin
     * surface exposes no project settings — `app.services.i18n` is the *editor*
     * language, which is a different thing entirely. See README "Known gaps".
     */
    locales: LocaleCode[];
    achievements: Achievement[];
    stats: SteamStat[];
};

export const DEFAULT_LOCALE: LocaleCode = "en";

export function emptyCatalog(): AchievementCatalog {
    return {
        version: CATALOG_VERSION,
        locales: [DEFAULT_LOCALE],
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

/** Coerce an untrusted `Record<LocaleCode, string>` without dropping unknown locales. */
function readLocalizedText(value: unknown): Record<LocaleCode, string> {
    const record = readRecord(value);
    if (!record) {
        return {};
    }
    const out: Record<LocaleCode, string> = {};
    for (const [locale, text] of Object.entries(record)) {
        const code = locale.trim();
        if (code && typeof text === "string") {
            out[code] = text;
        }
    }
    return out;
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
    const achievement: Achievement = {
        id,
        name: readLocalizedText(record.name),
        description: readLocalizedText(record.description),
        hidden: record.hidden === true,
    };
    const iconAchieved = readTrimmed(record.iconAchievedAssetId);
    const iconUnachieved = readTrimmed(record.iconUnachievedAssetId);
    if (iconAchieved) {
        achievement.iconAchievedAssetId = iconAchieved;
    }
    if (iconUnachieved) {
        achievement.iconUnachievedAssetId = iconUnachieved;
    }
    const progress = readRecord(record.progress);
    const statId = progress ? readTrimmed(progress.statId) : "";
    if (progress && statId) {
        achievement.progress = { statId, max: readFiniteNumber(progress.max, 0) };
    }
    return achievement;
}

/**
 * Coerce untrusted stored data into a well-formed catalog. Never throws: a
 * corrupt catalog degrades to fewer entries rather than breaking the editor tab
 * or a running game.
 */
export function normalizeCatalog(value: unknown): AchievementCatalog {
    const record = readRecord(value);
    if (!record) {
        return emptyCatalog();
    }
    const locales: LocaleCode[] = [];
    if (Array.isArray(record.locales)) {
        for (const raw of record.locales) {
            const code = readTrimmed(raw);
            if (code && !locales.includes(code)) {
                locales.push(code);
            }
        }
    }
    if (locales.length === 0) {
        locales.push(DEFAULT_LOCALE);
    }
    const catalog: AchievementCatalog = {
        version: CATALOG_VERSION,
        locales,
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

/** Text for a locale, falling back to the first locale that has any. */
export function localizedText(
    text: Record<LocaleCode, string>,
    locale: LocaleCode,
    locales: LocaleCode[],
): string {
    const exact = text[locale];
    if (exact && exact.trim()) {
        return exact;
    }
    for (const code of locales) {
        const candidate = text[code];
        if (candidate && candidate.trim()) {
            return candidate;
        }
    }
    return "";
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
 * Errors are things Steam will reject or that make a node unrunnable; warnings
 * are things that ship but read badly (an achievement with no text in a language
 * the game is released in shows up blank in the Steam overlay).
 */
export function validateCatalog(catalog: AchievementCatalog): CatalogIssue[] {
    const issues: CatalogIssue[] = [];
    const seenAchievements = new Set<string>();
    const seenStats = new Set<string>();

    for (const stat of catalog.stats) {
        if (!STEAM_API_NAME_PATTERN.test(stat.id)) {
            issues.push({
                severity: "error",
                subjectId: stat.id,
                message: `Stat API Name "${stat.id}" must match A-Z a-z 0-9 _ (1-44 characters)`,
            });
        }
        if (seenStats.has(stat.id)) {
            issues.push({ severity: "error", subjectId: stat.id, message: `Duplicate stat "${stat.id}"` });
        }
        seenStats.add(stat.id);
        if (stat.min !== undefined && stat.max !== undefined && stat.min > stat.max) {
            issues.push({ severity: "error", subjectId: stat.id, message: `Stat "${stat.id}" has min above max` });
        }
    }

    for (const achievement of catalog.achievements) {
        if (!STEAM_API_NAME_PATTERN.test(achievement.id)) {
            issues.push({
                severity: "error",
                subjectId: achievement.id,
                message: `API Name "${achievement.id}" must match A-Z a-z 0-9 _ (1-44 characters)`,
            });
        }
        if (seenAchievements.has(achievement.id)) {
            issues.push({
                severity: "error",
                subjectId: achievement.id,
                message: `Duplicate API Name "${achievement.id}"`,
            });
        }
        seenAchievements.add(achievement.id);

        if (achievement.progress) {
            if (!seenStats.has(achievement.progress.statId)) {
                issues.push({
                    severity: "error",
                    subjectId: achievement.id,
                    message: `Progress references unknown stat "${achievement.progress.statId}"`,
                });
            }
            if (!(achievement.progress.max > 0)) {
                issues.push({
                    severity: "error",
                    subjectId: achievement.id,
                    message: "Progress max must be above zero",
                });
            }
        }

        for (const locale of catalog.locales) {
            if (!readTrimmed(achievement.name[locale])) {
                issues.push({
                    severity: "warning",
                    subjectId: achievement.id,
                    message: `Missing name for ${locale}`,
                });
            }
            if (!readTrimmed(achievement.description[locale])) {
                issues.push({
                    severity: "warning",
                    subjectId: achievement.id,
                    message: `Missing description for ${locale}`,
                });
            }
        }
    }

    if (catalog.achievements.length > 0 && !catalog.appId) {
        issues.push({ severity: "warning", message: "No Steam App ID set" });
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
