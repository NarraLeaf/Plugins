/**
 * What a Ren2Leaf pack is known to get wrong, measured on real ports. Each caveat names the
 * scanner versions it holds for, so one Ren2Leaf fixes drops out for packs it wrote.
 *
 * Written in English: they are read by the agent, beside Studio's own English tool text.
 */

import type { QueryKind } from "./query";

/** What a caveat can look at to tell whether the pack's game has the thing it is about. */
export type PackFacts = {
    inventory: Record<string, unknown> | null;
    chapters: unknown;
};

export type Caveat = {
    id: string;
    /** README sections it applies to; `"5"` also covers 5.1, 5.2 … */
    sections: string[];
    kinds: QueryKind[];
    /** Last scanner version that still has the problem. */
    throughScanner: string;
    text: string;
    /**
     * Whether the game has what the caveat is about. Without it, or when the scan does not say,
     * the caveat applies: a warning too many costs less than a mistake left unflagged.
     */
    applies?: (facts: PackFacts) => boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function at(root: unknown, ...path: string[]): unknown {
    let node = root;
    for (const step of path) {
        if (!isRecord(node)) return undefined;
        node = node[step];
    }
    return node;
}

/** `undefined` when the scan has no such list, so the caller can tell "none" from "not scanned". */
function rows(root: unknown, ...path: string[]): Record<string, unknown>[] | undefined {
    const value = at(root, ...path);
    return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function pythonEntries(facts: PackFacts): Record<string, unknown>[] | undefined {
    return rows(facts.inventory, "extensions", "python", "entries");
}

const TITLE_LABELS = new Set(["splashscreen", "main_menu", "_main_menu", "before_main_menu"]);

export const CAVEATS: Caveat[] = [
    {
        id: "excluded-reachable",
        sections: ["5"],
        kinds: ["ending", "label", "file"],
        throughScanner: "0.2.0",
        text: "A file the migrator excluded can still be entered by a jump from reachable flow, and only `return` is counted as an ending: `jump splashscreen` or a return to the main menu ends the game too. Before trusting an ending count of 0, look for jumps into every excluded file.",
        applies: facts => {
            const endings = rows(facts.inventory, "extensions", "flow", "endings");
            const labels = rows(facts.inventory, "extensions", "flow", "labels");
            if (!endings || !labels) return true;
            const excluded = at(facts.chapters, "excluded");
            return endings.length === 0
                || (Array.isArray(excluded) && excluded.length > 0)
                || labels.some(label => Array.isArray(label.out) && label.out.some(edge => isRecord(edge) && TITLE_LABELS.has(String(edge.to))));
        },
    },
    {
        id: "achievement-location",
        sections: ["4", "7"],
        kinds: ["achievement"],
        throughScanner: "0.2.0",
        text: "The achievement location is the `achievement.grant` line inside the wrapper label; the real unlock points are the `call achievement(\"N\")` sites. The who -> achievement id -> `steam='…'` mapping is not expanded: read that label.",
        applies: facts => {
            const ach = at(facts.inventory, "extensions", "facts", "achievements");
            if (!isRecord(ach)) return true;
            return ["wrappers", "declared", "unlockPoints", "granted"].some(key => Array.isArray(ach[key]) && (ach[key] as unknown[]).length > 0);
        },
    },
    {
        id: "chapter-terms",
        sections: ["5"],
        kinds: ["file"],
        throughScanner: "0.2.0",
        text: "The pack's terms run chapter -> story; Studio's run story -> chapter -> scene. A split per file does not mean one Studio story per file.",
    },
    {
        id: "auto-voice",
        sections: ["3", "7"],
        kinds: ["speaker"],
        throughScanner: "0.2.0",
        text: "When options.rpy sets `config.auto_voice`, the pack reports 0 voiced lines although every line has a voice file. Recompute the voice ids with Ren'Py's auto_voice rule before mapping voice.",
        applies: facts => {
            const entries = pythonEntries(facts);
            return !entries || entries.some(entry => entry.target === "config.auto_voice" || entry.variable === "config.auto_voice");
        },
    },
    {
        id: "image-geometry",
        sections: ["8"],
        kinds: ["asset"],
        throughScanner: "0.2.0",
        text: "Image geometry is not in the pack: zoom, negative xzoom (mirroring) and alignment in `image` statements, LayeredImageProxy transforms, `group … auto` in layered images, and global hooks such as `config.adjust_attributes`. Read them from the source; each changes what the sprite looks like.",
        applies: facts => {
            const defined = at(facts.inventory, "extensions", "assets", "summary", "imageDefinitions");
            const entries = pythonEntries(facts);
            if (typeof defined !== "number" || !entries) return true;
            return defined > 0 || entries.some(entry => String(entry.target ?? "").startsWith("config.adjust_attributes"));
        },
    },
    {
        id: "gallery-unknown",
        sections: ["4"],
        kinds: ["python", "gallery"],
        throughScanner: "0.2.0",
        text: "`Gallery()` button and image calls listed as 'origin unknown' are the gallery catalogue, not logic for a blueprint.",
        applies: facts => {
            const entries = pythonEntries(facts);
            return !entries || entries.some(entry => /(?:^|[^\w.])Gallery\s*\(/.test(String(entry.snippet ?? "")));
        },
    },
    {
        id: "defines-as-variables",
        sections: ["4"],
        kinds: ["variable"],
        throughScanner: "0.2.0",
        text: "Asset path defines (bgm_*, sound_*) and screen runtime variables can be listed as story variables. Only state the story reads or writes needs a Studio variable.",
        applies: facts => {
            const variables = rows(facts.inventory, "extensions", "python", "variables");
            return !variables || variables.length > 0;
        },
    },
    {
        id: "screens-one-state",
        sections: ["6"],
        kinds: ["screen"],
        throughScanner: "0.2.0",
        text: "Each screen was captured in one state. A screen that changes with persistent data (a main menu before and after completion) has a second look the pack does not show, and ImageButton rows name the idle image only: hover and selected images are in screens.rpy.",
    },
];

/** Numeric comparison of dotted versions; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
    const pa = a.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
    const pb = b.split(/[.+-]/).map(part => Number.parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return Math.sign(diff);
    }
    return 0;
}

function holds(caveat: Caveat, scannerVersion: string): boolean {
    return compareVersions(scannerVersion, caveat.throughScanner) <= 0;
}

function relevant(caveat: Caveat, facts?: PackFacts): boolean {
    return !facts || !caveat.applies || caveat.applies(facts);
}

/** `facts` leaves out the caveats about things this game does not have; without it, all apply. */
export function caveatsForSection(sectionId: string, scannerVersion: string, facts?: PackFacts): Caveat[] {
    const top = sectionId.split(".")[0]!;
    return CAVEATS.filter(caveat => holds(caveat, scannerVersion) && relevant(caveat, facts)
        && caveat.sections.some(section => section === sectionId || section === top || sectionId.startsWith(`${section}.`)));
}

export function caveatsForKind(kind: QueryKind, scannerVersion: string, facts?: PackFacts): Caveat[] {
    return CAVEATS.filter(caveat => holds(caveat, scannerVersion) && relevant(caveat, facts) && caveat.kinds.includes(kind));
}
