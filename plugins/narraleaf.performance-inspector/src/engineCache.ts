/**
 * What the engine's own image cache says it is holding.
 *
 * ## Why this had to be asked for rather than measured
 *
 * Everything else this plugin knows about memory it works out by watching the browser: it wraps
 * `fetch`, it counts object URLs that were minted and never revoked, and it calls that "held in
 * memory". That worked while the engine was the thing minting them - it fetched bytes, made a blob,
 * made an object URL, and kept the URL alive for exactly as long as it meant to keep the picture.
 *
 * **A host can now serve the game's assets itself**, and Studio does. The url a row resolved is
 * already one the browser can fetch and cache, so the engine is handed the url instead of the bytes
 * and mints nothing. Watching object URLs in that game counts zero - not because nothing is held,
 * but because the mechanism being watched is no longer the one in use. A profiler that reports that
 * as "no memory held" is worse than one that reports nothing, so it asks the engine directly.
 *
 * The engine answers with its own accounting, which is the only place both halves are visible: the
 * bytes it fetched (zero when the host owns them) and the decoded bitmaps it is keeping, which are
 * the expensive half and the one with a budget behind it.
 */

/**
 * The engine's `ImageCacheStats`, as `app.game.diagnostics` hands it over.
 *
 * Restated rather than imported so this file says what it depends on; the host's declaration is the
 * contract, and a mismatch is a compile error where it is read.
 */
export type EngineImageCache = {
    entries: number;
    blobBytes: number;
    decodedEntries: number;
    decodedBytes: number;
    pinned: number;
    budget: {
        blobBytes: number;
        decodedBytes: number;
    };
};

/** How the plugin reaches it. Absent on a build whose manifest did not ask for `diagnostics`. */
export type EngineCacheReader = () => EngineImageCache | null;

/**
 * Whether the engine is holding urls rather than bytes - the case that makes this plugin's own
 * object-URL count meaningless.
 *
 * Entries with no bytes behind them is exactly that shape: the cache is tracking pictures, and
 * something other than the engine is paying for them. Both numbers at zero is an empty cache and
 * says nothing either way, which is why it is not enough to test the bytes alone.
 */
export function hostOwnsImageBytes(cache: EngineImageCache | null): boolean {
    return !!cache && cache.entries > 0 && cache.blobBytes === 0;
}

/**
 * The share of a budget in use, or null where the game removed the limit.
 *
 * `Infinity` is a legitimate setting rather than a missing value, and a bar drawn against it would
 * be permanently empty - so the caller is told to print the amount and no proportion.
 */
export function budgetShare(used: number, budget: number): number | null {
    if (!Number.isFinite(budget) || budget <= 0) {
        return null;
    }
    return used / budget;
}
