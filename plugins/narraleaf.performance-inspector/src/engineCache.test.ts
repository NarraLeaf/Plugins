/**
 * The engine reading, and the one thing about it that is easy to report backwards.
 *
 * `hostOwnsImageBytes` exists because "no bytes held" and "nothing held" look identical in a number
 * and mean opposite things. Every case below is a shape a real build produces.
 */

import { describe, expect, it } from "vitest";
import { budgetShare, hostOwnsImageBytes, type EngineImageCache } from "./engineCache";

function cache(overrides: Partial<EngineImageCache> = {}): EngineImageCache {
    return {
        entries: 0,
        blobBytes: 0,
        decodedEntries: 0,
        decodedBytes: 0,
        pinned: 0,
        budget: { blobBytes: 268_435_456, decodedBytes: 134_217_728 },
        ...overrides,
    };
}

describe("hostOwnsImageBytes", () => {
    it("is true when the cache tracks pictures it paid nothing for", () => {
        // What Studio's own preload takeover produces: urls handed to the player, bytes held by the
        // browser. The object-URL count elsewhere in this plugin reads zero here and means nothing.
        expect(hostOwnsImageBytes(cache({ entries: 283, blobBytes: 0, decodedBytes: 132_644_372 }))).toBe(true);
    });

    it("is false when the player fetched the bytes itself", () => {
        expect(hostOwnsImageBytes(cache({ entries: 103, blobBytes: 215_117_040 }))).toBe(false);
    });

    it("is false for an empty cache, which says nothing about who owns anything", () => {
        // The reason the test is on entries and not on bytes alone: a cache holding nothing also
        // holds no bytes, and calling that "the host owns them" would put the notice on every game
        // during boot.
        expect(hostOwnsImageBytes(cache())).toBe(false);
    });

    it("is false when there is no reading at all", () => {
        expect(hostOwnsImageBytes(null)).toBe(false);
    });
});

describe("budgetShare", () => {
    it("reports the fraction in use", () => {
        expect(budgetShare(64, 256)).toBe(0.25);
    });

    it("answers null for a budget the game removed, rather than a share of infinity", () => {
        expect(budgetShare(64, Infinity)).toBeNull();
    });

    it("answers null for a zero budget instead of dividing by it", () => {
        expect(budgetShare(64, 0)).toBeNull();
    });

    it("does not clamp: over budget is a real state and reads as over", () => {
        expect(budgetShare(300, 256)).toBeCloseTo(1.171875);
    });
});
