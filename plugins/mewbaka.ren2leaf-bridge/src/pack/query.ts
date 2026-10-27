/**
 * Looking things up in `inventory.json` by kind, so an agent reads the ten rows it needs rather than
 * the whole scan. Pure; the tool wraps it.
 */

export const QUERY_KINDS = [
    "speaker",
    "character",
    "label",
    "menu",
    "ending",
    "file",
    "dynamic",
    "screen",
    "python",
    "function",
    "variable",
    "gallery",
    "statement",
    "achievement",
    "transform",
    "transition",
    "audio",
    "asset",
    "review",
] as const;
export type QueryKind = typeof QUERY_KINDS[number];

type Inventory = Record<string, unknown>;

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

function list(value: unknown): Record<string, unknown>[] {
    return Array.isArray(value) ? value.filter(isRecord) : [];
}

type KindSpec = {
    /** What the kind covers, for the tool description and for an empty answer. */
    about: string;
    rows(inventory: Inventory): Record<string, unknown>[];
    /** Fields `key` is matched against, first hit wins. */
    keys: string[];
    /** A kind that is one object rather than a list of rows. */
    single?: boolean;
};

const ext = (inventory: Inventory, name: string) => at(inventory, "extensions", name);

export const KIND_SPECS: Record<QueryKind, KindSpec> = {
    speaker: { about: "Character variables with line counts, voice dirs, sprite tags and samples", rows: i => list(at(ext(i, "speakers"), "speakers")), keys: ["variable"] },
    character: { about: "Character definitions as declared", rows: i => list(i.characters), keys: ["variable"] },
    label: { about: "Labels with flow in/out, reachability and play order", rows: i => list(at(ext(i, "flow"), "labels")), keys: ["name"] },
    menu: { about: "Choice menus", rows: i => list(at(ext(i, "flow"), "menus")), keys: ["label", "name"] },
    ending: {
        about: "Endings, and labels the scanner decided are not endings (notEnding: true)",
        rows: i => [
            ...list(at(ext(i, "flow"), "endings")),
            ...list(at(ext(i, "flow"), "notEndings")).map(row => ({ ...row, notEnding: true })),
        ],
        keys: ["name"],
    },
    file: { about: "Script files: lines, says, labels, menus, endings, play order", rows: i => list(at(ext(i, "flow"), "files")), keys: ["file"] },
    dynamic: { about: "Jumps, calls and shows whose target is computed at run time", rows: i => list(at(ext(i, "flow"), "dynamicTargets")), keys: ["label"] },
    screen: { about: "Screens: category, call sites, actions, elements, classification", rows: i => list(i.screens), keys: ["name"] },
    python: { about: "Python lines and blocks, classified, with a suggested mapping", rows: i => list(at(ext(i, "python"), "entries")), keys: ["label", "func", "callee"] },
    function: { about: "The game's own Python functions and their call sites", rows: i => list(at(ext(i, "python"), "functions")), keys: ["name"] },
    variable: {
        about: "Variables and persistent fields with their writes",
        rows: i => [
            ...list(at(ext(i, "python"), "variables")),
            ...list(at(ext(i, "python"), "persistent")).map(row => ({ ...row, persistent: true })),
        ],
        keys: ["name"],
    },
    gallery: { about: "Gallery() catalogues: buttons, images, unlock conditions", rows: i => list(at(ext(i, "python"), "galleries")), keys: ["gallery", "button"] },
    statement: { about: "Custom statements (renpy.register_statement) and their usages", rows: i => list(at(ext(i, "python"), "customStatements")), keys: ["name"] },
    achievement: { about: "Achievement wrappers, declarations, unlock points and grants", rows: i => [at(ext(i, "facts"), "achievements")].filter(isRecord), keys: [], single: true },
    transform: { about: "ATL transforms in use, including long or infinite loops", rows: i => [at(ext(i, "facts"), "transforms")].filter(isRecord), keys: [], single: true },
    transition: { about: "Transitions with use counts and sites", rows: i => list(at(ext(i, "facts"), "transitions")), keys: ["name"] },
    audio: { about: "Audio statements with use counts and sites", rows: i => list(at(ext(i, "facts"), "audio")), keys: ["name"] },
    asset: { about: "Asset findings: missing, case mismatch, duplicates, formats, fonts, notes", rows: i => [ext(i, "assets")].filter(isRecord), keys: [], single: true },
    review: { about: "Lines the scanner flagged for a person to review", rows: i => list(i.needsReview), keys: ["kind"] },
};

export type QueryArgs = {
    kind: QueryKind;
    key?: string;
    file?: string;
    cursor?: number;
    limit?: number;
};

export type QueryResult = {
    rows: Record<string, unknown>[];
    total: number;
    nextCursor: number | null;
};

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;
/** Stay well inside the 60 000 characters a tool answer may carry. */
export const TEXT_BUDGET = 48_000;

export function queryInventory(inventory: Inventory, args: QueryArgs): QueryResult {
    const spec = KIND_SPECS[args.kind];
    let rows = spec.rows(inventory);
    if (args.key) {
        const key = args.key;
        rows = rows.filter(row => spec.keys.some(field => row[field] === key));
    }
    if (args.file) {
        const file = args.file;
        rows = rows.filter(row => typeof row.file === "string" && (row.file === file || row.file.endsWith(`/${file}`)));
    }
    const total = rows.length;
    const start = Math.max(0, args.cursor ?? 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, args.limit ?? DEFAULT_LIMIT));
    const page: Record<string, unknown>[] = [];
    let size = 0;
    for (let index = start; index < Math.min(total, start + limit); index++) {
        const row = rows[index]!;
        const length = JSON.stringify(row).length;
        if (page.length > 0 && size + length > TEXT_BUDGET) break;
        page.push(row);
        size += length;
    }
    const next = start + page.length;
    return { rows: page, total, nextCursor: next < total ? next : null };
}

/** The migrator's own entry for a speaker variable, from `speakers.json`, when there is one. */
export function speakerDecision(speakers: unknown, variable: unknown): unknown {
    if (typeof variable !== "string") return undefined;
    return at(speakers, "speakers", variable);
}
