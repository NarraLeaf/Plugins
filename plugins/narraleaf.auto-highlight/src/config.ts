/**
 * Project-level configuration, shared by both entries.
 *
 * The config is authored in the Studio (studio entry) and written into the plugin's
 * `config` runtime-data namespace, so it travels with the packed game and the runtime entry
 * can read it synchronously through `app.game.data.readJson("config")`. It is deliberately a
 * plain JSON object — no methods, no class — so it round-trips through the pack untouched.
 */

import type { CharacterId } from "./planner";

/** The runtime-data namespace declared in manifest.json (`contributes.runtimeData`). */
export const CONFIG_NAMESPACE = "config";

export interface AutoHighlightConfig {
    /** Darken strength for non-speakers, 0..1. */
    amount: number;
    /** Darken/restore transition duration, milliseconds. */
    durationMs: number;
    /**
     * Easing name passed to `image.darken`. Never empty: an empty easing used to make the
     * engine drop the duration and jump (fixed in NarraLeaf-React 0.13.0, but we still send a
     * real easing so the plugin behaves the same on older engines).
     */
    easing: string;
    /** Whether a narration line breaks a speaker's run (see the planner). */
    narrationBreaksRun: boolean;
    /** Characters that are never darkened (bound by stage object name). */
    exclude: CharacterId[];
}

export const DEFAULT_CONFIG: AutoHighlightConfig = {
    amount: 0.5,
    durationMs: 300,
    easing: "easeOut",
    narrationBreaksRun: true,
    exclude: [],
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Coerce whatever came back from the pack (possibly null, partial, or authored by an older
 * version) into a complete, sane config. Never throws — a broken or absent config must fall
 * back to defaults rather than break compilation.
 */
export function normalizeConfig(raw: unknown): AutoHighlightConfig {
    const o = (raw && typeof raw === "object" ? raw : {}) as Partial<AutoHighlightConfig>;
    const easing = typeof o.easing === "string" && o.easing.trim() ? o.easing : DEFAULT_CONFIG.easing;
    return {
        amount: typeof o.amount === "number" ? clamp01(o.amount) : DEFAULT_CONFIG.amount,
        durationMs: typeof o.durationMs === "number" && o.durationMs >= 0 ? o.durationMs : DEFAULT_CONFIG.durationMs,
        easing,
        narrationBreaksRun: typeof o.narrationBreaksRun === "boolean" ? o.narrationBreaksRun : DEFAULT_CONFIG.narrationBreaksRun,
        exclude: Array.isArray(o.exclude) ? o.exclude.filter((c): c is string => typeof c === "string") : [],
    };
}
