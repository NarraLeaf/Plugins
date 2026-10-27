/**
 * The rules of the stores the agent and the author both write: what a checklist item, a decision,
 * an issue, a log note and a line record may say. Each function takes the current store and returns
 * the next one, or throws a `RuleError` the tool turns into a refusal. Pure.
 */

import {
    ISSUE_SEVERITIES,
    LEDGER_AREAS,
    LEDGER_STATUSES,
    type Decision,
    type DecisionOption,
    type DecisionsStore,
    type Issue,
    type IssueSeverity,
    type IssuesStore,
    type LedgerArea,
    type LedgerItem,
    type LedgerStatus,
    type LedgerStore,
    type LineRecord,
    type LinesStore,
    type LogEntry,
    type LogStore,
    type SourceRef,
} from "./types";

export class RuleError extends Error {
    constructor(message: string, readonly hint?: string, readonly code: "invalid_args" | "not_found" = "invalid_args") {
        super(message);
    }
}

export const LOG_LIMIT = 500;

function text(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readSources(value: unknown): SourceRef[] {
    if (!Array.isArray(value)) return [];
    const refs: SourceRef[] = [];
    for (const entry of value) {
        if (typeof entry !== "object" || entry === null) continue;
        const file = text((entry as { file?: unknown }).file);
        if (!file) continue;
        const line = (entry as { line?: unknown }).line;
        refs.push(typeof line === "number" && Number.isInteger(line) ? { file, line } : { file });
    }
    return refs;
}

export function nextId(prefix: string, taken: Iterable<string>): string {
    let max = 0;
    for (const id of taken) {
        const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
        if (match) max = Math.max(max, Number(match[1]));
    }
    return `${prefix}-${max + 1}`;
}

// ── Checklist ───────────────────────────────────────────────────────────────────────────────────

export type LedgerPatch = {
    id: string;
    area?: string;
    title?: string;
    source?: unknown;
    plan?: string;
    status?: string;
    where?: string;
    decisionId?: string;
    note?: string;
};

function checkStatusAgainstDecision(item: LedgerItem, decisions: DecisionsStore): void {
    if (item.status !== "blocked" && item.status !== "dropped") return;
    const decision = item.decisionId ? decisions.items.find(entry => entry.id === item.decisionId) : undefined;
    if (!decision) {
        throw new RuleError(
            `"${item.id}" is ${item.status} without a decision.`,
            item.status === "dropped"
                ? "A feature is dropped only on the author's word: ask with decision_ask, keep porting other items, and set dropped with decisionId once the author has answered."
                : "Ask the author with decision_ask and pass its id as decisionId.",
        );
    }
    if (item.status === "dropped" && decision.status !== "answered") {
        throw new RuleError(
            `"${item.id}" cannot be dropped: decision ${decision.id} is ${decision.status}, not answered.`,
            "Set it to blocked until the author answers.",
        );
    }
}

/** Creates or updates checklist items. A new item needs area, title and plan. */
export function upsertLedger(
    ledger: LedgerStore,
    decisions: DecisionsStore,
    patches: LedgerPatch[],
    by: "agent" | "author",
    now: string,
): { ledger: LedgerStore; created: string[]; updated: string[] } {
    const items = ledger.items.map(item => ({ ...item }));
    const created: string[] = [];
    const updated: string[] = [];
    for (const patch of patches) {
        const id = text(patch.id);
        if (!id) throw new RuleError("Every item needs an id.", "Use a stable id such as \"ui.save-load\".");
        if (patch.area !== undefined && !LEDGER_AREAS.includes(patch.area as LedgerArea)) {
            throw new RuleError(`"${id}": area "${patch.area}" is not one of ${LEDGER_AREAS.join(", ")}.`);
        }
        if (patch.status !== undefined && !LEDGER_STATUSES.includes(patch.status as LedgerStatus)) {
            throw new RuleError(`"${id}": status "${patch.status}" is not one of ${LEDGER_STATUSES.join(", ")}.`);
        }
        const index = items.findIndex(item => item.id === id);
        const existing = index >= 0 ? items[index] : undefined;
        if (!existing && (!patch.area || !text(patch.title) || !text(patch.plan))) {
            throw new RuleError(`"${id}" is new and needs area, title and plan.`);
        }
        const next: LedgerItem = {
            id,
            area: (patch.area as LedgerArea | undefined) ?? existing!.area,
            title: text(patch.title) ?? existing!.title,
            source: patch.source !== undefined ? readSources(patch.source) : existing?.source ?? [],
            plan: text(patch.plan) ?? existing!.plan,
            status: (patch.status as LedgerStatus | undefined) ?? existing?.status ?? "todo",
            updatedBy: by,
            updatedAt: now,
        };
        const where = patch.where !== undefined ? text(patch.where) : existing?.where;
        if (where) next.where = where;
        const decisionId = patch.decisionId !== undefined ? text(patch.decisionId) : existing?.decisionId;
        if (decisionId) next.decisionId = decisionId;
        const note = patch.note !== undefined ? text(patch.note) : existing?.note;
        if (note) next.note = note;
        if (existing?.rejected && next.status !== "done") next.rejected = existing.rejected;
        checkStatusAgainstDecision(next, decisions);
        if (existing) {
            items[index] = next;
            updated.push(id);
        } else {
            items.push(next);
            created.push(id);
        }
    }
    return { ledger: { version: 1, items }, created, updated };
}

/** The author did not accept an item: it goes back to doing, with the note, until the agent finishes it again. */
export function rejectLedgerItem(ledger: LedgerStore, id: string, note: string, now: string): LedgerStore {
    return {
        version: 1,
        items: ledger.items.map(item => item.id === id
            ? { ...item, status: "doing", rejected: { note: note.trim(), at: now }, updatedBy: "author", updatedAt: now }
            : item),
    };
}

// ── Decisions ───────────────────────────────────────────────────────────────────────────────────

export type DecisionAsk = {
    question: string;
    context?: string;
    options?: { id?: string; label: string; consequence?: string }[];
    recommended?: string;
    source?: unknown;
};

export function askDecision(store: DecisionsStore, ask: DecisionAsk, now: string): { store: DecisionsStore; decision: Decision; existed: boolean } {
    const question = text(ask.question);
    if (!question) throw new RuleError("A decision needs a question.");
    const duplicate = store.items.find(item => item.status === "open" && item.question === question);
    if (duplicate) return { store, decision: duplicate, existed: true };
    const options: DecisionOption[] = (ask.options ?? []).map((option, index) => {
        const label = text(option.label);
        if (!label) throw new RuleError(`Option ${index + 1} has no label.`);
        const result: DecisionOption = { id: text(option.id) ?? String.fromCharCode(97 + index), label };
        const consequence = text(option.consequence);
        if (consequence) result.consequence = consequence;
        return result;
    });
    if (new Set(options.map(option => option.id)).size !== options.length) {
        throw new RuleError("Two options share an id.");
    }
    const recommended = text(ask.recommended);
    if (recommended && !options.some(option => option.id === recommended)) {
        throw new RuleError(`recommended "${recommended}" is not one of the option ids.`);
    }
    const decision: Decision = {
        id: nextId("d", store.items.map(item => item.id)),
        origin: "agent",
        question,
        source: readSources(ask.source),
        options,
        status: "open",
        seenByAgent: true,
        askedAt: now,
    };
    const context = text(ask.context);
    if (context) decision.context = context;
    if (recommended) decision.recommended = recommended;
    return { store: { version: 1, items: [...store.items, decision] }, decision, existed: false };
}

/** The author answers (or re-answers) a decision; the agent has not seen the answer yet. */
export function answerDecision(store: DecisionsStore, id: string, answer: { optionId?: string; text?: string }, now: string): DecisionsStore {
    const decision = store.items.find(item => item.id === id);
    if (!decision) throw new RuleError(`No decision ${id}.`, undefined, "not_found");
    if (decision.origin === "pack") throw new RuleError("Decisions from the pack are changed in Ren2Leaf, not here.");
    const optionId = text(answer.optionId);
    const words = text(answer.text);
    if (!optionId && !words) throw new RuleError("Pick an option or write an answer.");
    if (optionId && !decision.options.some(option => option.id === optionId)) {
        throw new RuleError(`Option ${optionId} is not one of this decision's options.`);
    }
    const recorded: NonNullable<Decision["answer"]> = { at: now };
    if (optionId) recorded.optionId = optionId;
    if (words) recorded.text = words;
    return {
        version: 1,
        items: store.items.map(item => item.id === id ? { ...item, status: "answered", answer: recorded, seenByAgent: false } : item),
    };
}

export function withdrawDecision(store: DecisionsStore, id: string): DecisionsStore {
    return {
        version: 1,
        items: store.items.map(item => item.id === id && item.origin === "agent" && item.status === "open"
            ? { ...item, status: "withdrawn" }
            : item),
    };
}

export function markSeen(store: DecisionsStore, ids: string[]): { store: DecisionsStore; marked: string[]; unknown: string[] } {
    const known = new Set(store.items.map(item => item.id));
    const wanted = new Set(ids);
    const marked: string[] = [];
    const items = store.items.map(item => {
        if (!wanted.has(item.id) || item.seenByAgent) return item;
        marked.push(item.id);
        return { ...item, seenByAgent: true };
    });
    return { store: { version: 1, items }, marked, unknown: ids.filter(id => !known.has(id)) };
}

export function answerSummary(decision: Decision): string {
    if (!decision.answer) return "";
    const option = decision.answer.optionId ? decision.options.find(entry => entry.id === decision.answer!.optionId) : undefined;
    return [option ? `${option.id}) ${option.label}` : "", decision.answer.text ?? ""].filter(Boolean).join(" - ");
}

// ── Issues ──────────────────────────────────────────────────────────────────────────────────────

export type IssueInput = Partial<Omit<Issue, "id" | "createdAt" | "status" | "severity">> & { severity?: string };

export function addIssues(store: IssuesStore, inputs: IssueInput[], now: string): { store: IssuesStore; ids: string[] } {
    const items = [...store.items];
    const ids: string[] = [];
    for (const input of inputs) {
        const title = text(input.title);
        if (!title) throw new RuleError("Every issue needs a title.");
        const severity = (input.severity ?? "minor") as IssueSeverity;
        if (!ISSUE_SEVERITIES.includes(severity)) {
            throw new RuleError(`severity "${input.severity}" is not one of ${ISSUE_SEVERITIES.join(", ")}.`);
        }
        const issue: Issue = { id: nextId("i", items.map(item => item.id)), title, severity, status: "open", createdAt: now };
        for (const key of ["tool", "args", "error", "expected", "workaround"] as const) {
            const value = text(input[key]);
            if (value) issue[key] = value;
        }
        items.push(issue);
        ids.push(issue.id);
    }
    return { store: { version: 1, items }, ids };
}

export function setIssueStatus(store: IssuesStore, id: string, status: Issue["status"]): IssuesStore {
    return { version: 1, items: store.items.map(item => item.id === id ? { ...item, status } : item) };
}

// ── Log ─────────────────────────────────────────────────────────────────────────────────────────

export function addLogNote(
    store: LogStore,
    note: { phase?: string; topic?: string; decision?: string; reason?: string },
    now: string,
): LogStore {
    const phase = text(note.phase);
    const decision = text(note.decision);
    if (!phase && !decision) throw new RuleError("Give a phase, a decision, or both.");
    const entries = [...store.entries];
    if (phase && phase !== store.phase) entries.push({ at: now, kind: "phase", text: phase });
    if (decision) {
        const entry: LogEntry = { at: now, kind: text(note.topic) ? "mapping" : "note", text: decision };
        const topic = text(note.topic);
        if (topic) entry.topic = topic;
        const reason = text(note.reason);
        if (reason) entry.reason = reason;
        entries.push(entry);
    }
    const next: LogStore = { version: 1, entries: entries.slice(-LOG_LIMIT) };
    const current = phase ?? store.phase;
    if (current) next.phase = current;
    return next;
}

// ── Line records ────────────────────────────────────────────────────────────────────────────────

export function recordLines(
    store: LinesStore,
    sceneId: string,
    entries: unknown[],
    replace: boolean,
    now: string,
): { store: LinesStore; count: number } {
    const lines: LineRecord[] = [];
    entries.forEach((entry, index) => {
        if (typeof entry !== "object" || entry === null) throw new RuleError(`entries[${index}] is not an object.`);
        const raw = entry as Record<string, unknown>;
        const file = text(raw.file);
        const unitId = text(raw.unitId);
        const line = raw.line;
        if (!file || !unitId || typeof line !== "number" || !Number.isInteger(line)) {
            throw new RuleError(`entries[${index}] needs file, line and unitId.`);
        }
        const record: LineRecord = { file, line, unitId };
        const voiceFile = text(raw.voiceFile);
        if (voiceFile) record.voiceFile = voiceFile;
        lines.push(record);
    });
    const previous = replace ? [] : store.scenes[sceneId]?.lines ?? [];
    const byUnit = new Map(previous.map(record => [record.unitId, record]));
    for (const record of lines) byUnit.set(record.unitId, record);
    return {
        store: { version: 1, scenes: { ...store.scenes, [sceneId]: { recordedAt: now, lines: [...byUnit.values()] } } },
        count: lines.length,
    };
}
