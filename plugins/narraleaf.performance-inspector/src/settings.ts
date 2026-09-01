/**
 * The one thing the editor writes and the game reads.
 *
 * The author fills this in from the Studio panel; it is published with the game through
 * `contributes.runtimeData` and read back at boot by the runtime entry. Both halves import this
 * module, so the shape cannot drift between the panel that writes it and the profiler that obeys it.
 *
 * {@link normalizeSettings} takes anything - null, a record written by an older version of this
 * plugin, a field an author's hand-edit broke - and returns a whole, valid settings object. A
 * profiler that refuses to start because one field is a string where a number was expected would be
 * the least useful failure mode available to it.
 */

export const PLUGIN_ID = "narraleaf.performance-inspector";

/** Published with the game; must match `contributes.runtimeData` in manifest.json. */
export const SETTINGS_NAMESPACE = `${PLUGIN_ID}.settings`;

export const SETTINGS_VERSION = 1;

/**
 * Where the profiler is allowed to arm itself.
 *
 * `studio` means "only while the game is running inside Studio", which is Dev Mode. That is the
 * default and it is the safe one: a build made without touching this setting cannot show a debug
 * overlay to a player, whatever they press.
 *
 * `everywhere` also arms previews and shipped builds. It is the setting an author needs, because the
 * build whose performance actually matters is the production one - a Dev Mode measurement is taken
 * against a development React and a development bundle. It is also the setting that ships the
 * profiler to players, so the panel says so next to the switch.
 *
 * There is no third value for "previews but not shipped builds": a preview and a shipped game are
 * the same shell running the same pack, and the page cannot tell them apart. Offering the choice
 * would mean pretending to a guarantee that is not there.
 */
export type OverlayAvailability = "studio" | "everywhere";

/**
 * When the probes go in.
 *
 * `gameStart` is the default because startup is one of the things most worth measuring - the asset
 * storm at boot, the wait before the first line - and none of it exists to be measured if collection
 * begins later. `graph` leaves the game untouched until a `Start Profiling` node runs, which is what
 * a bounded measurement ("this chapter, not the whole session") needs and what a shipped build that
 * carries the plugin but should cost nothing wants.
 */
export type CollectionStart = "gameStart" | "graph";

export const COLLECTION_STARTS: readonly CollectionStart[] = ["gameStart", "graph"];

/** What the overlay is showing. Also what the `Set Performance Overlay` node writes. */
export type OverlayView = "hidden" | "hud" | "inspector";

export const OVERLAY_VIEWS: readonly OverlayView[] = ["hidden", "hud", "inspector"];

/** Which corner the compact HUD sits in. The inspector is always centred. */
export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const OVERLAY_CORNERS: readonly OverlayCorner[] = [
    "top-left",
    "top-right",
    "bottom-left",
    "bottom-right",
];

/** How much frame history the ring buffer keeps. Longer windows cost memory and nothing else. */
export const HISTORY_SECONDS_CHOICES: readonly number[] = [30, 60, 300];

export type InspectorSettings = {
    version: number;
    availability: OverlayAvailability;
    collectFrom: CollectionStart;
    /**
     * What the overlay shows the moment the game starts.
     *
     * The plugin binds no keys of its own - opening the overlay is a `Set Performance Overlay` node,
     * which the author reaches from an `On Key Down` head bound to whatever chord they want, from a
     * button, or from a story row. So this setting is the one way to have it up from the first frame
     * without wiring anything.
     */
    openAt: OverlayView;
    historySeconds: number;
    corner: OverlayCorner;
    /**
     * Whether to wrap `fetch`, `XMLHttpRequest`, `Response.prototype.blob` and the object-URL
     * factory. Without it the asset and memory pages fall back to what the browser's own resource
     * timing reports, which on this shell's custom protocol is a list of URLs with no byte counts
     * and no retention - so the pages stay honest but go nearly empty.
     */
    instrumentAssets: boolean;
    /**
     * Write the written summary into the game's log whenever a report is captured. On a packaged
     * build that log is a file on the player's disk, which is the only report sink a shipped game
     * has that survives the process.
     */
    logOnCapture: boolean;
};

export const DEFAULT_SETTINGS: InspectorSettings = {
    version: SETTINGS_VERSION,
    availability: "studio",
    collectFrom: "gameStart",
    openAt: "hidden",
    historySeconds: 60,
    corner: "top-left",
    instrumentAssets: true,
    logOnCapture: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value)
        ? (value as T)
        : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

export function normalizeSettings(raw: unknown): InspectorSettings {
    if (!isRecord(raw)) {
        return { ...DEFAULT_SETTINGS };
    }
    const historySeconds = typeof raw.historySeconds === "number" && Number.isFinite(raw.historySeconds)
        ? HISTORY_SECONDS_CHOICES.reduce(
            (best, choice) =>
                Math.abs(choice - (raw.historySeconds as number)) < Math.abs(best - (raw.historySeconds as number))
                    ? choice
                    : best,
            HISTORY_SECONDS_CHOICES[0],
        )
        : DEFAULT_SETTINGS.historySeconds;

    return {
        version: SETTINGS_VERSION,
        availability: pick(raw.availability, ["studio", "everywhere"], DEFAULT_SETTINGS.availability),
        collectFrom: pick(raw.collectFrom, COLLECTION_STARTS, DEFAULT_SETTINGS.collectFrom),
        openAt: pick(raw.openAt, OVERLAY_VIEWS, DEFAULT_SETTINGS.openAt),
        historySeconds,
        corner: pick(raw.corner, OVERLAY_CORNERS, DEFAULT_SETTINGS.corner),
        instrumentAssets: pickBoolean(raw.instrumentAssets, DEFAULT_SETTINGS.instrumentAssets),
        logOnCapture: pickBoolean(raw.logOnCapture, DEFAULT_SETTINGS.logOnCapture),
    };
}
