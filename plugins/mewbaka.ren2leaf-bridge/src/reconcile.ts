/**
 * The line records held against the pack's own scan, file by file. Pure.
 *
 * `checkVoice` compares the records with Studio's voice takes, so it sees only what the agent
 * recorded: a port can be all green there while a source line or voice never made it into a record.
 * This counts the other way round, from the source: how many say lines and voiced say lines the
 * scan found in each script file, against how many records name that file.
 *
 * The counts do not have to agree, and the report says so. Ren'Py's `extend` continues the line
 * before it; a port that merges it into that line records one row for two source lines, and one
 * that splits a merge back into two rows records two again. In a real port every per-file
 * difference was exactly that: (extends merged) - (merges split back). Files the migrator excluded
 * or the game cannot reach may be left out on purpose. So nothing here is a failure: it is a list of
 * differences, each to be explained.
 */

import type { LinesStore } from "./types";

export type ReconcileLevel = "warning" | "info";

export type ReconcileCode =
    /** The pack has no per-file say counts; nothing to compare lines with. */
    | "lines-unavailable"
    /** The pack has no per-file voice counts. */
    | "voice-unavailable"
    /** The pack has say lines in a file no record names. */
    | "file-not-recorded"
    | "file-not-recorded-excluded"
    | "file-not-recorded-unreachable"
    /** Records name a file the pack has no say lines in. */
    | "file-not-in-pack"
    /** Fewer records than the pack's say lines in a file. */
    | "lines-fewer"
    /** More records than the pack's say lines in a file. */
    | "lines-more"
    /** The fewer-records differences add up to more than the game's extend lines can explain. */
    | "shortfall-exceeds-extends"
    /** Records with a voice file differ from the pack's voiced say lines in a file. */
    | "voice-differs"
    /** Voiced lines the pack counts but does not place in a file (narration, one-off speakers). */
    | "voiced-unplaced";

export type ReconcileFinding = {
    level: ReconcileLevel;
    code: ReconcileCode;
    file?: string;
    /** For the Studio test's translated message. */
    params: Record<string, string | number>;
    /** For the agent. */
    text: string;
};

export type ReconcileFile = {
    /** The pack's path for the file, or the recorded one when the pack has no such file. */
    file: string;
    /** Say lines in the pack; `null` when the pack has no row for the file. */
    packLines: number | null;
    recordedLines: number;
    /** Voiced say lines in the pack; `null` when the pack cannot say. */
    packVoiced: number | null;
    recordedVoiced: number;
    /** Source lines recorded more than once. */
    repeated: number;
    excluded: boolean;
    unreachable: boolean;
};

export type Reconciliation = {
    /** Whether the pack had per-file say counts to compare with. */
    lines: boolean;
    /** Whether the pack had per-file voice counts to compare with. */
    voice: boolean;
    /** The game's `extend` lines, the usual reason for fewer records; `null` when the pack does not say. */
    extendLines: number | null;
    /** Sum of (pack - recorded) over the files with fewer records. */
    shortfall: number;
    /** Sum of (recorded - pack) over the files with more records. */
    surplus: number;
    files: ReconcileFile[];
    findings: ReconcileFinding[];
};

/** Said with every voice comparison: the gap neither side can see. */
export const PAUSE_VOICE_NOTE = "Voices that play during a `pause` or a `menu` rather than on a say line are in neither count until Ren2Leaf exports them; check those in the source.";

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

function list(value: unknown): Record<string, unknown>[] | undefined {
    return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** A script path as the pack writes it: relative to game/, forward slashes. */
export function normalizeScriptPath(path: string): string {
    return path.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/^game\//, "");
}

/**
 * Which pack file a recorded path means: the same path, or the one pack path it is the tail of (or
 * that is its tail). `undefined` when none or several match.
 */
function resolveFile(recorded: string, packFiles: string[]): string | undefined {
    const path = normalizeScriptPath(recorded);
    if (packFiles.includes(path)) return path;
    const matches = packFiles.filter(file => file.endsWith(`/${path}`) || path.endsWith(`/${file}`));
    return matches.length === 1 ? matches[0] : undefined;
}

const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

export function reconcileWithPack(lines: LinesStore, inventory: Record<string, unknown> | null, chapters: unknown): Reconciliation {
    const flowFiles = list(at(inventory, "extensions", "flow", "files"));
    const packLines = new Map<string, number>();
    const unreachable = new Set<string>();
    for (const row of flowFiles ?? []) {
        const file = typeof row.file === "string" ? normalizeScriptPath(row.file) : undefined;
        const says = num(row.says);
        if (!file || says === undefined) continue;
        packLines.set(file, says);
        if (row.playOrder === null) unreachable.add(file);
    }
    const hasLines = packLines.size > 0;

    // Voiced say lines per file: a speaker's ranges count lines with a `voice` statement; under
    // config.auto_voice, each line whose computed file exists is voiced too.
    const speakers = list(at(inventory, "extensions", "speakers", "speakers"));
    const packVoiced = new Map<string, number>();
    let hasVoice = false;
    let placedVoiced = 0;
    for (const speaker of speakers ?? []) {
        for (const range of list(speaker.ranges) ?? []) {
            const voiced = num(range.voiced);
            if (typeof range.file !== "string" || voiced === undefined) continue;
            hasVoice = true;
            const file = normalizeScriptPath(range.file);
            packVoiced.set(file, (packVoiced.get(file) ?? 0) + voiced);
            placedVoiced += voiced;
        }
    }
    const autoEntries = list(at(inventory, "extensions", "speakers", "autoVoice", "entries"));
    for (const entry of autoEntries ?? []) {
        hasVoice = true;
        if (entry.exists !== true || typeof entry.file !== "string") continue;
        const file = normalizeScriptPath(entry.file);
        packVoiced.set(file, (packVoiced.get(file) ?? 0) + 1);
    }
    const voicedTotal = num(at(inventory, "extensions", "speakers", "summary", "voicedLines"));

    const excludedRaw = at(chapters, "excluded");
    const excluded = new Set(Array.isArray(excludedRaw) ? excludedRaw.filter((f): f is string => typeof f === "string").map(normalizeScriptPath) : []);

    const extendLines = num(at(inventory, "extensions", "speakers", "summary", "extendLines"))
        ?? num(at(inventory, "extensions", "facts", "summary", "extendLines"))
        ?? null;

    // Records by the pack file they name.
    const knownFiles = [...new Set([...packLines.keys(), ...packVoiced.keys()])];
    const rows = new Map<string, ReconcileFile>();
    const row = (file: string): ReconcileFile => {
        let entry = rows.get(file);
        if (!entry) {
            entry = {
                file,
                packLines: hasLines ? packLines.get(file) ?? null : null,
                recordedLines: 0,
                packVoiced: hasVoice ? packVoiced.get(file) ?? 0 : null,
                recordedVoiced: 0,
                repeated: 0,
                excluded: excluded.has(file),
                unreachable: unreachable.has(file),
            };
            rows.set(file, entry);
        }
        return entry;
    };
    const seen = new Map<string, number>();
    for (const scene of Object.values(lines.scenes)) {
        for (const record of scene.lines) {
            const file = resolveFile(record.file, knownFiles) ?? normalizeScriptPath(record.file);
            const entry = row(file);
            entry.recordedLines++;
            if (record.voiceFile) entry.recordedVoiced++;
            const key = `${file}:${record.line}`;
            const times = (seen.get(key) ?? 0) + 1;
            seen.set(key, times);
            if (times === 2) entry.repeated++;
        }
    }
    for (const [file, says] of packLines) if (says > 0) row(file);
    for (const [file, voiced] of packVoiced) if (voiced > 0) row(file);

    const files = [...rows.values()].sort((a, b) => a.file.localeCompare(b.file));
    const findings: ReconcileFinding[] = [];
    let shortfall = 0;
    let surplus = 0;

    if (!hasLines) {
        findings.push({
            level: "info",
            code: "lines-unavailable",
            params: {},
            text: "The pack has no per-file say-line counts, so the line records cannot be reconciled with its scan. Re-exporting it with a current Ren2Leaf adds them.",
        });
    } else {
        const extendHint = extendLines === null ? "" : ` (the game has ${extendLines} extend lines in all)`;
        for (const entry of files) {
            const pack = entry.packLines;
            if (pack === null) {
                if (entry.recordedLines > 0) {
                    findings.push({
                        level: "warning",
                        code: "file-not-in-pack",
                        file: entry.file,
                        params: { file: entry.file, recorded: entry.recordedLines },
                        text: `${entry.file}: ${entry.recordedLines} lines recorded, but the pack has no say lines in a file of that name. Record the path relative to game/, as the pack writes it.`,
                    });
                }
                continue;
            }
            if (entry.recordedLines === 0) {
                if (pack === 0) continue;
                const code: ReconcileCode = entry.excluded ? "file-not-recorded-excluded" : entry.unreachable ? "file-not-recorded-unreachable" : "file-not-recorded";
                const why = entry.excluded
                    ? "the migrator excluded it; leave it out only if it holds no story"
                    : entry.unreachable
                        ? "the game cannot reach it; leave it out only on purpose, and log why"
                        : "not ported yet, or recorded under another path";
                findings.push({
                    level: "info",
                    code,
                    file: entry.file,
                    params: { file: entry.file, pack },
                    text: `${entry.file}: ${pack} say lines in the pack, none recorded (${why}).`,
                });
                continue;
            }
            const delta = entry.recordedLines - pack;
            if (delta < 0) {
                shortfall -= delta;
                findings.push({
                    level: "info",
                    code: "lines-fewer",
                    file: entry.file,
                    params: { file: entry.file, pack, recorded: entry.recordedLines, delta: signed(delta) },
                    text: `${entry.file}: ${signed(delta)} (pack ${pack} say lines, ${entry.recordedLines} recorded). Explain it: each extend merged into the line before is -1, each merge split back into two rows +1${extendHint}; any other difference is a lost line.`,
                });
            } else if (delta > 0) {
                surplus += delta;
                findings.push({
                    level: "warning",
                    code: "lines-more",
                    file: entry.file,
                    params: { file: entry.file, pack, recorded: entry.recordedLines, delta: signed(delta), repeated: entry.repeated },
                    text: `${entry.file}: ${signed(delta)} (pack ${pack} say lines, ${entry.recordedLines} recorded${entry.repeated ? `, ${entry.repeated} source lines recorded more than once` : ""}). More rows than source lines: a line recorded twice, or something that is not a say line recorded as one.`,
                });
            }
        }
        if (extendLines !== null && shortfall > extendLines) {
            findings.push({
                level: "warning",
                code: "shortfall-exceeds-extends",
                params: { shortfall, extends: extendLines },
                text: `Across files, ${shortfall} fewer lines are recorded than the pack has, more than the game's ${extendLines} extend lines can explain: some source lines were not ported or not recorded.`,
            });
        }
    }

    if (!hasVoice) {
        findings.push({
            level: "info",
            code: "voice-unavailable",
            params: {},
            text: "The pack has no per-file voice counts (speakers[].ranges[].voiced), so recorded voice files cannot be reconciled with its scan.",
        });
    } else {
        for (const entry of files) {
            if (entry.packVoiced === null || entry.recordedLines === 0) continue;
            if (entry.packVoiced === entry.recordedVoiced) continue;
            findings.push({
                level: "warning",
                code: "voice-differs",
                file: entry.file,
                params: { file: entry.file, pack: entry.packVoiced, recorded: entry.recordedVoiced },
                text: `${entry.file}: the pack has ${entry.packVoiced} voiced say lines, ${entry.recordedVoiced} records carry a voice file. A voice was dropped, or put on the wrong line (an extend with its own voice merged into the line before loses it).`,
            });
        }
        const unplaced = voicedTotal === undefined ? 0 : voicedTotal - placedVoiced;
        if (unplaced > 0) {
            findings.push({
                level: "info",
                code: "voiced-unplaced",
                params: { count: unplaced },
                text: `${unplaced} voiced lines of the pack (narration, one-off speakers, an extend after narration) are not counted per file, so a file can show more recorded voice files than the pack.`,
            });
        }
    }

    return { lines: hasLines, voice: hasVoice, extendLines, shortfall, surplus, files, findings };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const files = (count: number) => plural(count, "file", "files");

/** One line for `port_status` and the head of `voice_check`. */
export function reconcileSummary(report: Reconciliation): string {
    const parts: string[] = [];
    if (report.lines) {
        const compared = report.files.filter(file => file.packLines !== null && file.recordedLines > 0);
        const differing = compared.filter(file => file.recordedLines !== file.packLines);
        const pending = report.files.filter(file => file.packLines && file.recordedLines === 0).length;
        parts.push(`say lines match the pack in ${compared.length - differing.length} of ${compared.length} recorded ${compared.length === 1 ? "file" : "files"}`
            + (report.shortfall ? `, ${report.shortfall} fewer recorded${report.extendLines === null ? "" : ` (the game has ${plural(report.extendLines, "extend line", "extend lines")})`}` : "")
            + (report.surplus ? `, ${report.surplus} more recorded than the pack has` : "")
            + (pending ? `; ${files(pending)} with say lines ${pending === 1 ? "has" : "have"} no records` : ""));
    } else {
        parts.push("the pack cannot reconcile line counts (no per-file say counts)");
    }
    if (report.voice) {
        const voiceDiffers = report.findings.filter(finding => finding.code === "voice-differs").length;
        parts.push(voiceDiffers ? `voice differs from the pack in ${files(voiceDiffers)}` : "voiced lines match the pack in every recorded file");
    } else {
        parts.push("the pack cannot reconcile voice (no per-file voice counts)");
    }
    return `Against the pack's scan: ${parts.join("; ")}. Differences are to be explained, not errors in themselves.`;
}
