import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileSummary, reconcileWithPack } from "./reconcile";
import type { LineRecord, LinesStore } from "./types";

/** A pack's scan as Ren2Leaf 0.3.0 writes the parts the reconciliation reads. */
function inventory(options: { extendLines?: number; auto?: object[] } = {}) {
    return {
        extensions: {
            flow: {
                files: [
                    { file: "script/script.rpy", says: 0, playOrder: 0 },
                    { file: "script/c1.rpy", says: 10, playOrder: 1 },
                    { file: "script/c2.rpy", says: 5, playOrder: 2 },
                    { file: "script/debug.rpy", says: 4, playOrder: null },
                ],
            },
            speakers: {
                summary: { voicedLines: 4, extendLines: options.extendLines ?? 2 },
                speakers: [
                    { variable: "a", ranges: [{ file: "script/c1.rpy", lines: 6, voiced: 3 }, { file: "script/c2.rpy", lines: 2, voiced: 0 }] },
                    { variable: "b", ranges: [{ file: "script/c2.rpy", lines: 1, voiced: 0 }] },
                ],
                ...(options.auto ? { autoVoice: { entries: options.auto } } : {}),
            },
        },
    };
}

function records(file: string, from: number, count: number, voiced = 0): LineRecord[] {
    return Array.from({ length: count }, (_, index) => ({
        file,
        line: from + index,
        unitId: `${file}-${from + index}`,
        ...(index < voiced ? { voiceFile: `voice/a/a(${index + 1}).mp3` } : {}),
    }));
}

function lines(...scenes: LineRecord[][]): LinesStore {
    return { version: 1, scenes: Object.fromEntries(scenes.map((list, index) => [`scene-${index}`, { recordedAt: "2026-10-28T00:00:00Z", lines: list }])) };
}

const codes = (report: ReturnType<typeof reconcileWithPack>) => report.findings.map(finding => `${finding.level} ${finding.code}${finding.file ? ` ${finding.file}` : ""}`).sort();

test("per file, records are held against the pack's say lines and voiced lines", () => {
    // c1: two extend lines merged into the line before (10 -> 8), every voice kept. c2: all five
    // lines, but one voice put on a line that had none. debug.rpy: unreachable, not ported. One
    // record names a file the pack does not have.
    const report = reconcileWithPack(
        lines(records("c1.rpy", 20, 8, 3), records("game/script/c2.rpy", 5, 5, 1), records("c3.rpy", 1, 2)),
        inventory(),
        { excluded: ["script/script.rpy"] },
    );
    assert.equal(report.lines, true);
    assert.equal(report.voice, true);
    assert.equal(report.shortfall, 2);
    assert.equal(report.surplus, 0);
    assert.deepEqual(codes(report), [
        "info file-not-recorded-unreachable script/debug.rpy",
        "info lines-fewer script/c1.rpy",
        "info voiced-unplaced",
        "warning file-not-in-pack c3.rpy",
        "warning voice-differs script/c2.rpy",
    ]);
    const c1 = report.files.find(file => file.file === "script/c1.rpy")!;
    assert.deepEqual([c1.packLines, c1.recordedLines, c1.packVoiced, c1.recordedVoiced], [10, 8, 3, 3]);
    assert.match(report.findings.find(finding => finding.code === "lines-fewer")!.text, /-2 \(pack 10 say lines, 8 recorded\).*extend.*\(the game has 2 extend lines in all\)/);
    // The excluded file has no say lines, so there is nothing to say about it.
    assert.ok(!report.findings.some(finding => finding.file === "script/script.rpy"));
    assert.match(reconcileSummary(report), /say lines match the pack in 1 of 2 recorded files, 2 fewer recorded \(the game has 2 extend lines\); 1 files with say lines have no records; voice differs from the pack in 1 files/);
});

test("a shortfall the extend lines cannot explain, and more records than source lines, are warnings", () => {
    const twice = records("c2.rpy", 5, 5);
    const report = reconcileWithPack(
        lines(records("c1.rpy", 20, 5, 3), [...twice, { ...twice[0]!, unitId: "again" }], records("debug.rpy", 1, 4)),
        inventory({ extendLines: 2 }),
        null,
    );
    assert.equal(report.shortfall, 5);
    assert.equal(report.surplus, 1);
    assert.deepEqual(codes(report), [
        "info lines-fewer script/c1.rpy",
        "info voiced-unplaced",
        "warning lines-more script/c2.rpy",
        "warning shortfall-exceeds-extends",
    ]);
    assert.match(report.findings.find(finding => finding.code === "lines-more")!.text, /\+1 .*1 source lines recorded more than once/);
});

test("lines under config.auto_voice count as voiced where the computed file exists", () => {
    const auto = [
        { file: "script/c2.rpy", line: 5, id: "c2_aaaa0001", voice: "voice/c2_aaaa0001.ogg", exists: true },
        { file: "script/c2.rpy", line: 6, id: "c2_aaaa0002", voice: "voice/c2_aaaa0002.ogg", exists: false },
    ];
    const report = reconcileWithPack(lines(records("script/c2.rpy", 5, 5, 1)), inventory({ auto }), null);
    const c2 = report.files.find(file => file.file === "script/c2.rpy")!;
    assert.equal(c2.packVoiced, 1);
    assert.ok(!report.findings.some(finding => finding.code === "voice-differs"));
});

test("a pack without per-file counts says it cannot reconcile, and nothing else", () => {
    const older = { extensions: { flow: { files: [{ file: "script.rpy", lines: 240 }] }, speakers: { speakers: [{ variable: "s", lines: 14 }] } } };
    const report = reconcileWithPack(lines(records("script.rpy", 1, 3, 1)), older, null);
    assert.equal(report.lines, false);
    assert.equal(report.voice, false);
    assert.deepEqual(codes(report), ["info lines-unavailable", "info voice-unavailable"]);
    assert.match(reconcileSummary(report), /the pack cannot reconcile line counts .*the pack cannot reconcile voice/);
    assert.deepEqual(codes(reconcileWithPack(lines(), null, null)), ["info lines-unavailable", "info voice-unavailable"]);
});

test("a recorded path that is the tail of two pack files is not guessed", () => {
    const twoNames = { extensions: { flow: { files: [{ file: "a/c1.rpy", says: 1 }, { file: "b/c1.rpy", says: 1 }] } } };
    const report = reconcileWithPack(lines(records("c1.rpy", 1, 1)), twoNames, null);
    assert.ok(report.findings.some(finding => finding.code === "file-not-in-pack" && finding.file === "c1.rpy"));
});
