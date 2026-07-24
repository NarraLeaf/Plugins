/**
 * The plugin's story-action ids, shared by the studio entry (which registers them) and the
 * runtime entry (which recognizes them in the compiled scene). Ids are namespaced by the
 * plugin id, matching Studio's contributes prefix rule.
 */

import type { Marker } from "./planner";

const PREFIX = "narraleaf.auto-highlight";

export const ACTION_IDS = {
    enable: `${PREFIX}.enable`,
    disable: `${PREFIX}.disable`,
    highlight: `${PREFIX}.highlight`,
    highlightAll: `${PREFIX}.highlight-all`,
    darkenAll: `${PREFIX}.darken-all`,
} as const;

/** Params carried by the Highlight Characters block. */
export interface HighlightParams {
    /** Stage object names to keep lit; everyone else is darkened. */
    characters: string[];
}

/**
 * Map one of this plugin's action blocks to a planner {@link Marker}. Returns null for an
 * unknown action id (e.g. a block authored by a newer version), so the caller treats it as a
 * neutral block rather than guessing.
 */
export function markerFor(actionId: string, params: Record<string, unknown>): Marker | null {
    switch (actionId) {
        case ACTION_IDS.enable:
            return { op: "enable" };
        case ACTION_IDS.disable:
            return { op: "disable" };
        case ACTION_IDS.highlightAll:
            return { op: "highlightAll" };
        case ACTION_IDS.darkenAll:
            return { op: "darkenAll" };
        case ACTION_IDS.highlight: {
            const raw = (params as Partial<HighlightParams>).characters;
            const characters = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === "string") : [];
            return { op: "highlight", characters };
        }
        default:
            return null;
    }
}
