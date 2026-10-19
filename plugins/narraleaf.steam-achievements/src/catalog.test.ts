/**
 * The catalog's pure half. Every function here runs in both the editor and a
 * shipped game, against JSON that has sat on disk across plugin versions and
 * schema changes — so the cases worth writing down are the malformed ones.
 */

import { describe, expect, it } from "vitest";
import {
    CATALOG_VERSION,
    carriedProgressMax,
    clampStatValue,
    emptyCatalog,
    findAchievement,
    findStat,
    issuesBySubject,
    normalizeCatalog,
    validateCatalog,
    type AchievementCatalog,
    type SteamStat,
} from "./catalog";

function catalog(patch: Partial<AchievementCatalog> = {}): AchievementCatalog {
    return { ...emptyCatalog(), ...patch };
}

describe("normalizeCatalog", () => {
    it("turns anything unusable into an empty catalog rather than throwing", () => {
        for (const input of [null, undefined, 42, "catalog", [], true]) {
            expect(normalizeCatalog(input)).toEqual(emptyCatalog());
        }
    });

    it("drops entries with no id instead of keeping unaddressable ones", () => {
        const result = normalizeCatalog({
            achievements: [{ id: "KEPT" }, { id: "   " }, { name: {} }, null, 7],
            stats: [{ id: "KEPT_STAT" }, {}, "nope"],
        });
        expect(result.achievements.map(item => item.id)).toEqual(["KEPT"]);
        expect(result.stats.map(item => item.id)).toEqual(["KEPT_STAT"]);
    });

    it("carries the fields a 0.1 catalog stored on an achievement through untouched", () => {
        // Names, descriptions, icons and the hidden flag are no longer asked for,
        // but they are the author's own words; the next write must not drop them.
        const stored = {
            id: " A ",
            name: { en: "One", ja: "いち" },
            description: { en: "First" },
            hidden: true,
            iconAchievedAssetId: "asset-1",
            progress: { statId: "S", max: 10 },
        };
        const [achievement] = normalizeCatalog({ locales: ["en"], achievements: [stored] }).achievements;
        expect(achievement).toEqual({ ...stored, id: "A" });
    });

    it("no longer writes a language list of its own", () => {
        expect(normalizeCatalog({ locales: ["en", "zh-CN"] })).not.toHaveProperty("locales");
    });

    it("reads a stat authored while avgrate existed as float, not int", () => {
        // An average-rate value is fractional; truncating it would lose data the
        // mirror already holds.
        expect(normalizeCatalog({ stats: [{ id: "S", type: "avgrate" }] }).stats[0].type).toBe("float");
        expect(normalizeCatalog({ stats: [{ id: "S", type: "nonsense" }] }).stats[0].type).toBe("int");
        expect(normalizeCatalog({ stats: [{ id: "S", type: "float" }] }).stats[0].type).toBe("float");
    });

    it("rejects non-finite numbers rather than storing NaN", () => {
        const [stat] = normalizeCatalog({
            stats: [{ id: "S", defaultValue: Number.NaN, min: Number.POSITIVE_INFINITY, max: 10 }],
        }).stats;
        expect(stat.defaultValue).toBe(0);
        expect(stat.min).toBeUndefined();
        expect(stat.max).toBe(10);
    });

    it("stamps the current version even on data that claimed another", () => {
        expect(normalizeCatalog({ version: 99 }).version).toBe(CATALOG_VERSION);
    });

    it("keeps an appId only when it is a non-empty string", () => {
        expect(normalizeCatalog({ appId: "  480 " }).appId).toBe("480");
        expect(normalizeCatalog({ appId: "   " }).appId).toBeUndefined();
        expect(normalizeCatalog({ appId: 480 }).appId).toBeUndefined();
    });
});

describe("validateCatalog", () => {
    const errors = (input: AchievementCatalog) =>
        validateCatalog(input).filter(issue => issue.severity === "error").map(issue => issue.message);

    it("rejects API names Steam would not accept", () => {
        const messages = errors(catalog({
            achievements: [{ id: "has space" }],
            stats: [{ id: "né", type: "int", defaultValue: 0 }],
        }));
        expect(messages).toEqual([
            expect.stringContaining("Stat API Name"),
            expect.stringContaining("API Name"),
        ]);
    });

    it("rejects an API name longer than Steam's 44 characters", () => {
        expect(errors(catalog({
            achievements: [{ id: "A".repeat(45) }],
        }))).toHaveLength(1);
        expect(errors(catalog({
            achievements: [{ id: "A".repeat(44) }],
        }))).toHaveLength(0);
    });

    it("catches duplicates on both sides", () => {
        const messages = errors(catalog({
            achievements: [{ id: "SAME" }, { id: "SAME" }],
            stats: [
                { id: "S", type: "int", defaultValue: 0 },
                { id: "S", type: "int", defaultValue: 0 },
            ],
        }));
        expect(messages).toEqual([
            expect.stringContaining("Duplicate stat"),
            expect.stringContaining("Duplicate API Name"),
        ]);
    });

    it("catches a stat whose min is above its max", () => {
        expect(errors(catalog({
            stats: [{ id: "S", type: "int", defaultValue: 0, min: 10, max: 1 }],
        }))).toEqual([expect.stringContaining("min above max")]);
    });

    it("says nothing about the text a 0.1 catalog carries", () => {
        // That text is set in Steamworks now; a missing translation of it is not
        // something this catalog can be wrong about.
        expect(validateCatalog(catalog({
            appId: "480",
            achievements: [{ id: "A", name: { en: "One" }, progress: { statId: "GONE", max: 0 } }],
        }))).toEqual([]);
    });

    it("warns about a missing App ID only once there is something to unlock", () => {
        expect(validateCatalog(catalog())).toEqual([]);
        expect(validateCatalog(catalog({
            achievements: [{ id: "A" }],
        }))).toEqual([{ severity: "warning", message: "No Steam App ID set" }]);
    });
});

describe("issuesBySubject", () => {
    it("groups by subject and drops catalog-wide issues", () => {
        const grouped = issuesBySubject([
            { severity: "error", subjectId: "A", message: "one" },
            { severity: "warning", subjectId: "A", message: "two" },
            { severity: "warning", message: "catalog-wide" },
        ]);
        expect([...grouped.keys()]).toEqual(["A"]);
        expect(grouped.get("A")).toHaveLength(2);
    });
});

describe("clampStatValue", () => {
    const stat = (patch: Partial<SteamStat> = {}): SteamStat =>
        ({ id: "S", type: "int", defaultValue: 0, ...patch });

    it("truncates for int and keeps the fraction for float", () => {
        expect(clampStatValue(stat(), 0, 3.9)).toBe(3);
        expect(clampStatValue(stat({ type: "float" }), 0, 3.9)).toBeCloseTo(3.9);
    });

    it("truncates toward zero, so a negative int does not gain a point", () => {
        expect(clampStatValue(stat(), 0, -3.9)).toBe(-3);
    });

    it("holds an increment-only stat at its previous value", () => {
        expect(clampStatValue(stat({ incrementOnly: true }), 10, 4)).toBe(10);
        expect(clampStatValue(stat({ incrementOnly: true }), 10, 12)).toBe(12);
    });

    it("applies min and max", () => {
        expect(clampStatValue(stat({ min: 5 }), 0, 1)).toBe(5);
        expect(clampStatValue(stat({ max: 5 }), 0, 9)).toBe(5);
    });

    it("lets bounds win over increment-only, so a lowered max is honoured", () => {
        expect(clampStatValue(stat({ incrementOnly: true, max: 5 }), 9, 3)).toBe(5);
    });

    it("passes the value through untouched when the stat is unknown", () => {
        // An id no longer in the catalog still has a mirror value; clamping it to
        // some default would rewrite data the author never asked to change.
        expect(clampStatValue(null, 0, 3.9)).toBeCloseTo(3.9);
    });
});

describe("carriedProgressMax", () => {
    it("reads the maximum a 0.1 catalog stored on the achievement", () => {
        expect(carriedProgressMax({ id: "A", progress: { statId: "S", max: 10 } })).toBe(10);
    });

    it("answers null for anything that would not have drawn a toast", () => {
        expect(carriedProgressMax(null)).toBeNull();
        expect(carriedProgressMax({ id: "A" })).toBeNull();
        expect(carriedProgressMax({ id: "A", progress: { max: 0 } })).toBeNull();
        expect(carriedProgressMax({ id: "A", progress: { max: "10" } })).toBeNull();
        expect(carriedProgressMax({ id: "A", progress: "yes" })).toBeNull();
    });
});

describe("findAchievement / findStat", () => {
    const source = catalog({
        achievements: [{ id: "A" }],
        stats: [{ id: "S", type: "int", defaultValue: 0 }],
    });

    it("finds by id, tolerating the whitespace a wired pin can carry", () => {
        expect(findAchievement(source, " A ")?.id).toBe("A");
        expect(findStat(source, " S ")?.id).toBe("S");
    });

    it("returns null for an empty or unknown id", () => {
        expect(findAchievement(source, "   ")).toBeNull();
        expect(findAchievement(source, "MISSING")).toBeNull();
        expect(findStat(source, "MISSING")).toBeNull();
    });
});
