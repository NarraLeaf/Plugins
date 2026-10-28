/**
 * What the plugin keeps in project storage. One type per namespace (see `ids.ts`); each carries a
 * `version` so a later release can migrate rather than misread.
 */

export type SourceRef = { file: string; line?: number };

/** One `##` or `###` part of the pack's README, cut at its heading. */
export type ReadmeSection = {
    /** `"5"`, `"5.3"`; the README's own numbering. `"title"` for the text before the first heading. */
    id: string;
    title: string;
    body: string;
};

/** One screenshot the migrator took, with what it shows. */
export type ShotIndexEntry = {
    /** The capture's file stem, `shot-20261019-233032`. */
    key: string;
    /** The migrator's label for it, `主界面`. */
    label: string;
    /** Ren'Py screen names it shows, `["say", "quick_menu"]`. */
    screens: string[];
    /** Path of the picture inside the pack folder, `screens/shot-….png`. */
    image: string;
    elementCount: number;
};

export type PackStore = {
    version: 1;
    importedAt: string;
    /**
     * The name of the folder the author picked. Display only: the browser picker that chose it does
     * not say where it is, and nothing is read from it after import.
     */
    sourcePath: string;
    /** `inventory.schemaVersion` and the scanner that wrote it; caveats are matched against these. */
    schemaVersion: number;
    scanner: { name: string; version: string };
    game: { name: string; width: number | null; height: number | null };
    sections: ReadmeSection[];
    shots: ShotIndexEntry[];
    /** `data/speakers.json` and `data/chapters.json` as the pack has them. */
    speakers: unknown;
    chapters: unknown;
};

export type ScreenElement = Record<string, unknown>;

export type ScreensStore = {
    version: 1;
    shots: Record<string, { gameSize: [number, number] | null; elements: ScreenElement[] }>;
};

export type ImageKind = "screenshot" | "crop" | "portrait";

/**
 * The pack's pictures, scaled down at import and keyed by their path in the pack
 * (`screens/shot-….png`, `characters/s.png`). PNG or JPEG because that is what an agent tool may
 * return; screenshots are JPEG, crops and portraits keep their transparency as PNG.
 */
export type ImagesStore = {
    version: 1;
    files: Record<string, { kind: ImageKind; label: string; mimeType: "image/png" | "image/jpeg"; data: string }>;
};

export type InventoryStore = {
    version: 1;
    inventory: Record<string, unknown>;
};

export const LEDGER_AREAS = [
    "story",
    "variables",
    "characters",
    "stage",
    "audio",
    "voice",
    "interface",
    "system",
    "extras",
    "python",
    "other",
] as const;
export type LedgerArea = typeof LEDGER_AREAS[number];

export const LEDGER_STATUSES = ["todo", "doing", "done", "blocked", "dropped"] as const;
export type LedgerStatus = typeof LEDGER_STATUSES[number];

export type LedgerItem = {
    id: string;
    area: LedgerArea;
    title: string;
    source: SourceRef[];
    plan: string;
    status: LedgerStatus;
    /** Where it is implemented in Studio. */
    where?: string;
    /** `blocked` points at an open decision; `dropped` at one the author answered. */
    decisionId?: string;
    /** The author marked it as not accepted; cleared the next time it is set to done. */
    rejected?: { note: string; at: string };
    note?: string;
    updatedBy: "agent" | "author";
    updatedAt: string;
};

export type LedgerStore = { version: 1; items: LedgerItem[] };

export type DecisionOption = { id: string; label: string; consequence?: string };

export type Decision = {
    id: string;
    /** `pack`: a decision the migrator made in Ren2Leaf, read-only here. `agent`: asked through `decision_ask`. */
    origin: "pack" | "agent";
    question: string;
    context?: string;
    source: SourceRef[];
    options: DecisionOption[];
    recommended?: string;
    status: "open" | "answered" | "withdrawn";
    /**
     * `via: "conversation"` is an answer the author gave the agent in its own conversation, which the
     * agent recorded with the author's words in `quote`; without `via` it was given in the panel.
     */
    answer?: { optionId?: string; text?: string; at: string; via?: "conversation"; quote?: string };
    /** False from the moment the author answers until the agent calls `decision_seen`. */
    seenByAgent: boolean;
    askedAt: string;
};

export type DecisionsStore = { version: 1; items: Decision[] };

export const ISSUE_SEVERITIES = ["blocker", "major", "minor"] as const;
export type IssueSeverity = typeof ISSUE_SEVERITIES[number];

export type Issue = {
    id: string;
    title: string;
    tool?: string;
    args?: string;
    error?: string;
    expected?: string;
    workaround?: string;
    severity: IssueSeverity;
    status: "open" | "resolved";
    createdAt: string;
};

export type IssuesStore = { version: 1; items: Issue[] };

export type LogEntry = {
    at: string;
    kind: "phase" | "mapping" | "note";
    topic?: string;
    text: string;
    reason?: string;
};

export type LogStore = { version: 1; phase?: string; entries: LogEntry[] };

/** One say line of the original, where it landed in Studio, and the voice file it had. */
export type LineRecord = {
    file: string;
    line: number;
    unitId: string;
    voiceFile?: string;
};

export type LinesStore = {
    version: 1;
    scenes: Record<string, { recordedAt: string; lines: LineRecord[] }>;
};

export type BridgeState = {
    pack: PackStore | null;
    inventory: InventoryStore | null;
    screens: ScreensStore | null;
    images: ImagesStore | null;
    ledger: LedgerStore;
    decisions: DecisionsStore;
    issues: IssuesStore;
    log: LogStore;
    lines: LinesStore;
};

export function emptyState(): BridgeState {
    return {
        pack: null,
        inventory: null,
        screens: null,
        images: null,
        ledger: { version: 1, items: [] },
        decisions: { version: 1, items: [] },
        issues: { version: 1, items: [] },
        log: { version: 1, entries: [] },
        lines: { version: 1, scenes: {} },
    };
}
