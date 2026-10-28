/**
 * What a Ren2Leaf pack is known to get wrong, measured on real ports and checked against the
 * Ren2Leaf source. Each caveat names the scanner versions it holds for, so one Ren2Leaf fixes
 * drops out for packs it wrote, and one that is still open stays on for packs newer than this list.
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
    /** First scanner version that has the problem. Omitted: every version up to `throughScanner`. */
    fromScanner?: string;
    /**
     * Last scanner version that still has the problem. Omitted: no Ren2Leaf has fixed it yet, so it
     * holds for every later version too, until this list is told otherwise.
     */
    throughScanner?: string;
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

function count(root: unknown, ...path: string[]): number | undefined {
    const value = at(root, ...path);
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pythonEntries(facts: PackFacts): Record<string, unknown>[] | undefined {
    return rows(facts.inventory, "extensions", "python", "entries");
}

const TITLE_LABELS = new Set(["splashscreen", "main_menu", "_main_menu", "before_main_menu"]);

/** Labels Ren'Py enters by itself (Ren2Leaf's `ENGINE_LABELS`): no jump in the script leads to them. */
const ENGINE_LABELS = new Set([
    "start", "splashscreen", "before_main_menu", "main_menu", "after_load", "after_warp",
    "quit", "hide_windows", "_start", "_main_menu", "_quit", "autosave", "replay",
]);

/** The files the migrator excluded; `undefined` when the pack does not say. */
function excludedFiles(facts: PackFacts): string[] | undefined {
    const excluded = at(facts.chapters, "excluded");
    return Array.isArray(excluded) ? excluded.filter((file): file is string => typeof file === "string") : undefined;
}

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
            const excluded = excludedFiles(facts);
            return endings.length === 0
                || (excluded !== undefined && excluded.length > 0)
                || labels.some(label => Array.isArray(label.out) && label.out.some(edge => isRecord(edge) && TITLE_LABELS.has(String(edge.to))));
        },
    },
    {
        id: "excluded-entry-labels",
        sections: ["5"],
        kinds: ["file", "label"],
        text: "The excluded-files table counts only jumps and calls from other files as a way in. A file holding `start` or a label the engine enters by itself (`splashscreen`, `before_main_menu`, `main_menu`, `after_load`…) shows — there although the game runs it. Check every excluded file for those labels (pack_query kind label, file <path>) and port what they do.",
        applies: facts => {
            const excluded = excludedFiles(facts);
            if (excluded === undefined) return true;
            if (excluded.length === 0) return false;
            const files = rows(facts.inventory, "extensions", "flow", "files");
            if (!files) return true;
            return files.some(row => excluded.includes(String(row.file))
                && Array.isArray(row.labels)
                && row.labels.some(label => isRecord(label) && ENGINE_LABELS.has(String(label.name))));
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
        id: "voice-before-pause",
        sections: ["3", "7"],
        kinds: ["speaker", "voice"],
        text: "A `voice` statement followed by a `pause` or a `menu` before any say line plays during that pause or menu. The scan drops such voices: they are in no voiced-line count, speaker voice range or voice row. Search the source for `voice` lines whose next statement is `pause` or `menu`, and port each one where it plays.",
        applies: facts => {
            const voiced = count(facts.inventory, "extensions", "speakers", "summary", "voicedLines");
            const dirs = rows(facts.inventory, "extensions", "speakers", "voiceDirs");
            if (voiced === undefined && dirs === undefined) return true;
            return (voiced ?? 0) > 0 || (dirs ?? []).length > 0;
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
        id: "image-geometry-partial",
        sections: ["8"],
        kinds: ["asset"],
        fromScanner: "0.3.0",
        text: "The image placement table lists what each definition writes, not what the game shows: a `group … auto` is only flagged (its attributes are the files under game/images with that prefix), a `config.adjust_attributes` hook (section 4) is listed but its rewrite is not worked out, a tuple keyword such as `Transform(align=(0.5, 1.0))` is missed, and only the last definition of a name is listed. Check sprites that matter against the source.",
        applies: facts => {
            const assets = at(facts.inventory, "extensions", "assets");
            const geometry = rows(assets, "geometry");
            const hooks = rows(facts.inventory, "extensions", "python", "hooks");
            if (!geometry) return true;
            return geometry.length > 0
                || (rows(assets, "autoGroups") ?? []).length > 0
                || (hooks ?? []).some(hook => String(hook.hook ?? "").startsWith("config.adjust_attributes"));
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
        id: "gallery-unlock-image",
        sections: ["4"],
        kinds: ["gallery", "python"],
        text: "The gallery catalogue counts only `.image(…)` calls as pictures. `.unlock_image(\"x\")` is Ren'Py shorthand for `.image(\"x\")` plus `.unlock(\"x\")`, and the scan lists it under unlocks only, so a button can show 0 pictures. Count its unlock_image calls as pictures too.",
        applies: facts => {
            const galleries = rows(facts.inventory, "extensions", "python", "galleries");
            const entries = pythonEntries(facts);
            if (!galleries && !entries) return true;
            return (entries ?? []).some(entry => /\.unlock_image\b/.test(`${String(entry.callee ?? "")} ${String(entry.snippet ?? "")}`))
                || (galleries ?? []).some(group => Array.isArray(group.images) && group.images.length === 0 && Array.isArray(group.unlocks) && group.unlocks.length > 0);
        },
    },
    {
        id: "notify-blueprint",
        sections: ["4"],
        kinds: ["python"],
        text: "`renpy.notify` is mapped to a `/blueprint` row running Post Notification. That node needs the running game's interface, which a story row's blueprint does not have, so it fails there. Have the row set a persistent variable instead, and post the notification from a global blueprint on its `persistentVariableChanged` event.",
        applies: facts => {
            const usage = rows(facts.inventory, "extensions", "python", "apiUsage");
            const entries = pythonEntries(facts);
            if (!usage && !entries) return true;
            return (usage ?? []).some(row => row.api === "renpy.notify")
                || (entries ?? []).some(entry => entry.api === "renpy.notify" || /(?:^|[^\w.])renpy\.notify\s*\(/.test(String(entry.snippet ?? "")));
        },
    },
    {
        id: "interface-name-calls",
        sections: ["4"],
        kinds: ["python", "variable"],
        text: "A name listed as used only by the interface can still have its method calls (`.append(…)` and the like) listed as 'origin unknown' with a /blueprint suggestion. They fill interface data at init, such as the list a gallery screen reads: port them with the screen that reads the name, not as story rows.",
        applies: facts => {
            const names = rows(facts.inventory, "extensions", "python", "interfaceVariables");
            const entries = pythonEntries(facts);
            if (!names) return entries === undefined;
            const set = new Set(names.map(row => String(row.name)));
            return (entries ?? []).some(entry => {
                const callee = String(entry.callee ?? "");
                const dot = callee.indexOf(".");
                return dot > 0 && set.has(callee.slice(0, dot));
            });
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
        id: "menus-unreachable",
        sections: ["5"],
        kinds: ["menu"],
        text: "Menu and choice counts, and the menu table, include every `menu` in the source: ones in unreachable labels and test menus outside any label (label null) are counted and not marked. Check that a menu's label is reachable (pack_query kind label) before porting it.",
        applies: facts => {
            const menus = rows(facts.inventory, "extensions", "flow", "menus");
            const labels = rows(facts.inventory, "extensions", "flow", "labels");
            if (!menus || !labels) return true;
            const unreachable = new Set(labels.filter(label => label.reachable === false).map(label => String(label.name)));
            for (const row of rows(facts.inventory, "extensions", "flow", "unreachable") ?? []) unreachable.add(String(row.name));
            return menus.some(menu => menu.label === null || menu.label === undefined || unreachable.has(String(menu.label)));
        },
    },
    {
        id: "screens-one-state",
        sections: ["6"],
        kinds: ["screen"],
        text: "Each screen was captured in one state. A screen that changes with persistent data (a main menu before and after completion) has a second look the pack does not show. An ImageButton's hover and selected images are in its `states` when the capture recorded them; otherwise read them from screens.rpy.",
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

/** Whether the caveat is about the scanner version that wrote the pack. */
export function holdsFor(caveat: Caveat, scannerVersion: string): boolean {
    if (caveat.fromScanner && compareVersions(scannerVersion, caveat.fromScanner) < 0) return false;
    if (caveat.throughScanner && compareVersions(scannerVersion, caveat.throughScanner) > 0) return false;
    return true;
}

function relevant(caveat: Caveat, facts?: PackFacts): boolean {
    return !facts || !caveat.applies || caveat.applies(facts);
}

/** `facts` leaves out the caveats about things this game does not have; without it, all apply. */
export function caveatsForSection(sectionId: string, scannerVersion: string, facts?: PackFacts): Caveat[] {
    const top = sectionId.split(".")[0]!;
    return CAVEATS.filter(caveat => holdsFor(caveat, scannerVersion) && relevant(caveat, facts)
        && caveat.sections.some(section => section === sectionId || section === top || sectionId.startsWith(`${section}.`)));
}

export function caveatsForKind(kind: QueryKind, scannerVersion: string, facts?: PackFacts): Caveat[] {
    return CAVEATS.filter(caveat => holdsFor(caveat, scannerVersion) && relevant(caveat, facts) && caveat.kinds.includes(kind));
}
