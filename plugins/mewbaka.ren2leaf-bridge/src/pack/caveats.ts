/**
 * What a Ren2Leaf pack is known to get wrong, measured on real ports. Each caveat names the
 * scanner versions it holds for, so one Ren2Leaf fixes drops out for packs it wrote.
 *
 * Written in English: they are read by the agent, beside Studio's own English tool text.
 */

import type { QueryKind } from "./query";

export type Caveat = {
    id: string;
    /** README sections it applies to; `"5"` also covers 5.1, 5.2 … */
    sections: string[];
    kinds: QueryKind[];
    /** Last scanner version that still has the problem. */
    throughScanner: string;
    text: string;
};

export const CAVEATS: Caveat[] = [
    {
        id: "excluded-reachable",
        sections: ["5"],
        kinds: ["ending", "label", "file"],
        throughScanner: "0.2.0",
        text: "A file the migrator excluded can still be entered by a jump from reachable flow, and only `return` is counted as an ending: `jump splashscreen` or a return to the main menu ends the game too. Before trusting an ending count of 0, look for jumps into every excluded file.",
    },
    {
        id: "achievement-location",
        sections: ["4", "7"],
        kinds: ["achievement"],
        throughScanner: "0.2.0",
        text: "The achievement location is the `achievement.grant` line inside the wrapper label; the real unlock points are the `call achievement(\"N\")` sites. The who -> achievement id -> `steam='…'` mapping is not expanded: read that label.",
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
    },
    {
        id: "image-geometry",
        sections: ["8"],
        kinds: ["asset"],
        throughScanner: "0.2.0",
        text: "Image geometry is not in the pack: zoom, negative xzoom (mirroring) and alignment in `image` statements, LayeredImageProxy transforms, `group … auto` in layered images, and global hooks such as `config.adjust_attributes`. Read them from the source; each changes what the sprite looks like.",
    },
    {
        id: "gallery-unknown",
        sections: ["4"],
        kinds: ["python", "gallery"],
        throughScanner: "0.2.0",
        text: "`Gallery()` button and image calls listed as 'origin unknown' are the gallery catalogue, not logic for a blueprint.",
    },
    {
        id: "defines-as-variables",
        sections: ["4"],
        kinds: ["variable"],
        throughScanner: "0.2.0",
        text: "Asset path defines (bgm_*, sound_*) and screen runtime variables can be listed as story variables. Only state the story reads or writes needs a Studio variable.",
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

export function caveatsForSection(sectionId: string, scannerVersion: string): Caveat[] {
    const top = sectionId.split(".")[0]!;
    return CAVEATS.filter(caveat => holds(caveat, scannerVersion)
        && caveat.sections.some(section => section === sectionId || section === top || sectionId.startsWith(`${section}.`)));
}

export function caveatsForKind(kind: QueryKind, scannerVersion: string): Caveat[] {
    return CAVEATS.filter(caveat => holds(caveat, scannerVersion) && caveat.kinds.includes(kind));
}
