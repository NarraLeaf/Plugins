/**
 * The voice check: compare what the converter recorded (source line -> Studio line -> voice file)
 * with the voice takes the project actually has. Pure; the tool and the test feed it Studio's
 * `voice.listUnits()`.
 *
 * Studio keys a take by the line's unit id. Rewriting a scene gives its lines new ids, so takes
 * linked before the rewrite stay on ids no line has any more - Studio reports those with empty text.
 * That is how 391 and 650 voiced lines came off silently in two earlier ports.
 */

import type { LinesStore } from "./types";

export type VoiceUnit = { unitId: string; locale: string; text: string };

export type VoiceProblemKind =
    /** The line was recorded with a voice file but has no take. */
    | "unlinked"
    /** The record points at a unit no line has any more: the scene was rewritten after recording. */
    | "stale";

export type VoiceProblem = {
    kind: VoiceProblemKind;
    sceneId: string;
    file: string;
    line: number;
    unitId: string;
    voiceFile: string;
};

export type VoiceReport = {
    scenes: number;
    voicedLines: number;
    linked: number;
    problems: VoiceProblem[];
    /** Takes on unit ids no line has, not covered by a record. Left behind by rewrites. */
    strayTakes: number;
};

export function checkVoice(lines: LinesStore, units: VoiceUnit[], onlyScene?: string): VoiceReport {
    const byUnit = new Map<string, VoiceUnit[]>();
    for (const unit of units) {
        const list = byUnit.get(unit.unitId);
        if (list) list.push(unit);
        else byUnit.set(unit.unitId, [unit]);
    }
    const problems: VoiceProblem[] = [];
    const recorded = new Set<string>();
    let scenes = 0;
    let voicedLines = 0;
    let linked = 0;
    for (const [sceneId, scene] of Object.entries(lines.scenes)) {
        for (const record of scene.lines) recorded.add(record.unitId);
        if (onlyScene && sceneId !== onlyScene) continue;
        scenes++;
        for (const record of scene.lines) {
            if (!record.voiceFile) continue;
            voicedLines++;
            const takes = byUnit.get(record.unitId);
            const base = { sceneId, file: record.file, line: record.line, unitId: record.unitId, voiceFile: record.voiceFile };
            if (!takes || takes.length === 0) {
                problems.push({ kind: "unlinked", ...base });
            } else if (takes.every(take => take.text === "")) {
                problems.push({ kind: "stale", ...base });
            } else {
                linked++;
            }
        }
    }
    let strayTakes = 0;
    for (const [unitId, takes] of byUnit) {
        if (!recorded.has(unitId) && takes.every(take => take.text === "")) strayTakes++;
    }
    return { scenes, voicedLines, linked, problems, strayTakes };
}

/** Consecutive source lines in one file folded into ranges, `c1.rpy:120-388`, for a one-line notice. */
export function describeRanges(problems: VoiceProblem[], max = 3): string {
    const byFile = new Map<string, number[]>();
    for (const problem of problems) {
        const list = byFile.get(problem.file);
        if (list) list.push(problem.line);
        else byFile.set(problem.file, [problem.line]);
    }
    const parts: string[] = [];
    for (const [file, numbers] of byFile) {
        numbers.sort((a, b) => a - b);
        parts.push(`${file}:${numbers[0]}${numbers.length > 1 ? `-${numbers[numbers.length - 1]}` : ""}`);
    }
    return parts.length > max ? `${parts.slice(0, max).join(", ")} and ${parts.length - max} more files` : parts.join(", ");
}
