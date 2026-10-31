import { test } from "node:test";
import assert from "node:assert/strict";
import {
    addIssues,
    addLogNote,
    answerDecision,
    askDecision,
    markSeen,
    openQuestionCount,
    recordConversationAnswer,
    recordLines,
    rejectLedgerItem,
    RuleError,
    upsertLedger,
    withdrawDecision,
} from "./model";
import { emptyState } from "./types";
import { checkVoice, describeRanges } from "./voice";

const NOW = "2026-10-27T00:00:00.000Z";

test("a new checklist item needs area, title and plan; an update needs only the change", () => {
    const state = emptyState();
    assert.throws(() => upsertLedger(state.ledger, state.decisions, [{ id: "ui.save" }], "agent", NOW), /needs area, title and plan/);
    const first = upsertLedger(state.ledger, state.decisions, [{ id: "ui.save", area: "interface", title: "Save page", plan: "skeleton save page" }], "agent", NOW);
    assert.deepEqual(first.created, ["ui.save"]);
    assert.equal(first.ledger.items[0]!.status, "todo");
    const second = upsertLedger(first.ledger, state.decisions, [{ id: "ui.save", status: "done", where: "page Save" }], "agent", NOW);
    assert.deepEqual(second.updated, ["ui.save"]);
    assert.equal(second.ledger.items[0]!.plan, "skeleton save page");
    assert.equal(second.ledger.items[0]!.where, "page Save");
    assert.throws(() => upsertLedger(state.ledger, state.decisions, [{ id: "x", area: "nope", title: "t", plan: "p" }], "agent", NOW), /area "nope"/);
});

test("dropping a feature needs a decision the author answered", () => {
    const state = emptyState();
    const base = { id: "extras.gallery", area: "extras", title: "Gallery", plan: "gallery plugin" };
    assert.throws(() => upsertLedger(state.ledger, state.decisions, [{ ...base, status: "dropped" }], "agent", NOW), RuleError);
    const asked = askDecision(state.decisions, { question: "Keep the gallery?", options: [{ label: "Keep" }, { label: "Drop" }] }, NOW);
    assert.throws(
        () => upsertLedger(state.ledger, asked.store, [{ ...base, status: "dropped", decisionId: asked.decision.id }], "agent", NOW),
        /is open, not answered/,
    );
    const blocked = upsertLedger(state.ledger, asked.store, [{ ...base, status: "blocked", decisionId: asked.decision.id }], "agent", NOW);
    assert.equal(blocked.ledger.items[0]!.status, "blocked");
    const answered = answerDecision(asked.store, asked.decision.id, { optionId: "b" }, NOW);
    const dropped = upsertLedger(blocked.ledger, answered, [{ id: base.id, status: "dropped" }], "agent", NOW);
    assert.equal(dropped.ledger.items[0]!.status, "dropped");
});

test("a rejected item goes back to doing and the rejection clears when it is done again", () => {
    const state = emptyState();
    const done = upsertLedger(state.ledger, state.decisions, [{ id: "a", area: "story", title: "t", plan: "p", status: "done" }], "agent", NOW).ledger;
    const rejected = rejectLedgerItem(done, "a", "  wrong font  ", NOW);
    assert.equal(rejected.items[0]!.status, "doing");
    assert.equal(rejected.items[0]!.rejected!.note, "wrong font");
    const still = upsertLedger(rejected, state.decisions, [{ id: "a", note: "looking" }], "agent", NOW).ledger;
    assert.ok(still.items[0]!.rejected);
    const fixed = upsertLedger(rejected, state.decisions, [{ id: "a", status: "done" }], "agent", NOW).ledger;
    assert.equal(fixed.items[0]!.rejected, undefined);
});

test("decisions: ask, deduplicate, answer, mark seen, withdraw", () => {
    const state = emptyState();
    const first = askDecision(state.decisions, {
        question: "Who is ??? at c1:72?",
        options: [{ label: "The heroine", consequence: "bind to the heroine" }, { id: "x", label: "Someone else" }],
        recommended: "a",
        source: [{ file: "c1.rpy", line: 72 }, { nope: true }],
    }, NOW);
    assert.equal(first.decision.id, "d-1");
    assert.deepEqual(first.decision.options.map(option => option.id), ["a", "x"]);
    assert.deepEqual(first.decision.source, [{ file: "c1.rpy", line: 72 }]);
    assert.equal(askDecision(first.store, { question: "Who is ??? at c1:72?" }, NOW).existed, true);
    assert.throws(() => askDecision(state.decisions, { question: "q", options: [{ label: "a" }], recommended: "z" }, NOW), /recommended "z"/);
    assert.throws(() => answerDecision(first.store, "d-1", {}, NOW), /Pick an option/);
    assert.throws(() => answerDecision(first.store, "d-9", { text: "x" }, NOW), /No decision d-9/);
    const answered = answerDecision(first.store, "d-1", { optionId: "a", text: "only in chapter 1" }, NOW);
    assert.equal(answered.items[0]!.seenByAgent, false);
    const seen = markSeen(answered, ["d-1", "d-7"]);
    assert.deepEqual(seen.marked, ["d-1"]);
    assert.deepEqual(seen.unknown, ["d-7"]);
    const second = askDecision(seen.store, { question: "Another?" }, NOW);
    assert.equal(second.decision.id, "d-2");
    assert.equal(withdrawDecision(second.store, "d-2").items[1]!.status, "withdrawn");
});

test("an answer the author gave in conversation is recorded with their words, and only on an open question", () => {
    const state = emptyState();
    const asked = askDecision(state.decisions, { question: "Run the original to check the name plate?", options: [{ label: "Run it" }, { label: "Keep as is" }] }, NOW);
    assert.equal(openQuestionCount(asked.store), 1);
    assert.throws(() => recordConversationAnswer(asked.store, "d-1", { optionId: "a" }, NOW), /Quote the author's own words/);
    assert.throws(() => recordConversationAnswer(asked.store, "d-1", { quote: "yes", optionId: "z" }, NOW), /Option z/);
    assert.throws(() => recordConversationAnswer(asked.store, "d-9", { quote: "yes" }, NOW), /No decision d-9/);
    const recorded = recordConversationAnswer(asked.store, "d-1", { quote: "Go ahead, copy it first", optionId: "a" }, NOW);
    const decision = recorded.items[0]!;
    assert.equal(decision.status, "answered");
    assert.equal(decision.seenByAgent, true);
    assert.deepEqual(decision.answer, { at: NOW, via: "conversation", quote: "Go ahead, copy it first", optionId: "a" });
    assert.equal(openQuestionCount(recorded), 0);
    // An answer is the author's: the agent cannot overwrite one, from the panel or from a conversation.
    assert.throws(() => recordConversationAnswer(recorded, "d-1", { quote: "no" }, NOW), /already answered/);
    const inPanel = answerDecision(asked.store, "d-1", { optionId: "b" }, NOW);
    assert.throws(() => recordConversationAnswer(inPanel, "d-1", { quote: "yes" }, NOW), /Only the author changes an answer/);
    assert.throws(() => recordConversationAnswer(withdrawDecision(asked.store, "d-1"), "d-1", { quote: "yes" }, NOW), /withdrawn/);
});

test("issues and log notes", () => {
    const state = emptyState();
    const issues = addIssues(state.issues, [{ title: "ui_patch refuses a no-op", tool: "ui_patch", severity: "major" }, { title: "minor thing" }], NOW);
    assert.deepEqual(issues.ids, ["i-1", "i-2"]);
    assert.equal(issues.store.items[1]!.severity, "minor");
    assert.throws(() => addIssues(state.issues, [{ title: "x", severity: "huge" }], NOW), /severity "huge"/);
    assert.throws(() => addLogNote(state.log, {}, NOW), /phase, a decision/);
    const log = addLogNote(state.log, { phase: "converter", topic: "vpunch", decision: "four camera transforms", reason: "mirror ends off" }, NOW);
    assert.equal(log.phase, "converter");
    assert.deepEqual(log.entries.map(entry => entry.kind), ["phase", "mapping"]);
    assert.equal(addLogNote(log, { phase: "converter" }, NOW).entries.length, 2);
});

test("line records merge by unit id, or replace a scene", () => {
    const state = emptyState();
    const first = recordLines(state.lines, "scene-1", [
        { file: "c1.rpy", line: 10, unitId: "u1", voiceFile: "voice/a1.ogg" },
        { file: "c1.rpy", line: 11, unitId: "u2" },
    ], false, NOW);
    assert.equal(first.store.scenes["scene-1"]!.lines.length, 2);
    const merged = recordLines(first.store, "scene-1", [{ file: "c1.rpy", line: 12, unitId: "u3" }], false, NOW);
    assert.equal(merged.store.scenes["scene-1"]!.lines.length, 3);
    const replaced = recordLines(merged.store, "scene-1", [{ file: "c1.rpy", line: 10, unitId: "n1", voiceFile: "voice/a1.ogg" }], true, NOW);
    assert.deepEqual(replaced.store.scenes["scene-1"]!.lines.map(line => line.unitId), ["n1"]);
    assert.throws(() => recordLines(state.lines, "s", [{ file: "x", line: "3", unitId: "u" }], false, NOW), /needs file, line and unitId/);
});

test("the voice check finds stale records, unlinked lines and stray takes", () => {
    const state = emptyState();
    const lines = recordLines(state.lines, "s1", [
        { file: "c1.rpy", line: 120, unitId: "old1", voiceFile: "voice/1.ogg" },
        { file: "c1.rpy", line: 121, unitId: "ok1", voiceFile: "voice/2.ogg" },
        { file: "c1.rpy", line: 388, unitId: "new1", voiceFile: "voice/3.ogg" },
        { file: "c1.rpy", line: 389, unitId: "plain" },
    ], false, NOW).store;
    const units = [
        { unitId: "old1", locale: "ja", text: "" },
        { unitId: "ok1", locale: "ja", text: "Hello" },
        { unitId: "orphan", locale: "ja", text: "" },
    ];
    const report = checkVoice(lines, units);
    assert.equal(report.voicedLines, 3);
    assert.equal(report.linked, 1);
    assert.deepEqual(report.problems.map(problem => [problem.unitId, problem.kind]), [["old1", "stale"], ["new1", "unlinked"]]);
    assert.equal(report.strayTakes, 1);
    assert.equal(describeRanges(report.problems), "c1.rpy:120-388");
    assert.equal(checkVoice(lines, units, "other").voicedLines, 0);
});
