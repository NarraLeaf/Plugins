import { describe, expect, it } from "vitest";
import { normalizeConfig, DEFAULT_CONFIG } from "./config";
import { parseCharacterList } from "./actions";

describe("normalizeConfig — graceful degradation", () => {
    it("returns defaults for null / non-object (absent or unpublished config)", () => {
        expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
        expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
        expect(normalizeConfig(42)).toEqual(DEFAULT_CONFIG);
    });

    it("fills missing fields from defaults", () => {
        expect(normalizeConfig({ amount: 0.8 })).toEqual({ ...DEFAULT_CONFIG, amount: 0.8 });
    });

    it("clamps amount and rejects a negative duration", () => {
        expect(normalizeConfig({ amount: 5 }).amount).toBe(1);
        expect(normalizeConfig({ amount: -1 }).amount).toBe(0);
        expect(normalizeConfig({ durationMs: -10 }).durationMs).toBe(DEFAULT_CONFIG.durationMs);
    });

    it("never yields an empty easing (which would make the engine jump instead of animate)", () => {
        expect(normalizeConfig({ easing: "" }).easing).toBe(DEFAULT_CONFIG.easing);
        expect(normalizeConfig({ easing: "  " }).easing).toBe(DEFAULT_CONFIG.easing);
        expect(normalizeConfig({ easing: "linear" }).easing).toBe("linear");
    });

    it("keeps only string entries in exclude", () => {
        expect(normalizeConfig({ exclude: ["alice", 3, null, "bob"] }).exclude).toEqual(["alice", "bob"]);
        expect(normalizeConfig({ exclude: "nope" as unknown }).exclude).toEqual([]);
    });
});

describe("parseCharacterList", () => {
    it("splits on spaces and on the comma characters a Chinese keyboard produces", () => {
        expect(parseCharacterList("Alice Bob")).toEqual(["Alice", "Bob"]);
        expect(parseCharacterList("小明，小红、阿杰")).toEqual(["小明", "小红", "阿杰"]);
        expect(parseCharacterList("Alice, Bob")).toEqual(["Alice", "Bob"]);
    });

    it("collapses duplicates, keeps order, and reads nothing as an empty cast", () => {
        expect(parseCharacterList("Alice Bob Alice")).toEqual(["Alice", "Bob"]);
        expect(parseCharacterList("   ")).toEqual([]);
        expect(parseCharacterList(undefined)).toEqual([]);
    });
});
