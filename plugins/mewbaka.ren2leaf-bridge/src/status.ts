/**
 * What the agent is told about the state of the port: the notices every tool answer carries at its
 * top, and the full `port_status` summary. Pure, over `BridgeState`. English, for the model.
 */

import { advertisedName, TOOL } from "./ids";
import { answerSummary } from "./model";
import { LEDGER_AREAS, LEDGER_STATUSES, type BridgeState, type LedgerStatus } from "./types";
import type { VoiceReport } from "./voice";
import { describeRanges } from "./voice";

export const NOTICE_LIMIT = 3;
const TEXT_LIMIT = 58_000;

const tool = (name: string) => advertisedName(name);

function clip(value: string, max: number): string {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** At most three one-line notices, most urgent first. */
export function collectNotices(state: BridgeState): string[] {
    const notices: string[] = [];
    const answered = state.decisions.items.filter(item => item.origin === "agent" && item.status === "answered" && !item.seenByAgent);
    for (const decision of answered.slice(0, 2)) {
        notices.push(`The author answered ${decision.id} ("${clip(decision.question, 80)}"): ${clip(answerSummary(decision), 160)}. Act on it, then call ${tool(TOOL.decisionSeen)}.`);
    }
    if (answered.length > 2) {
        notices.push(`${answered.length - 2} more answers are waiting; ${tool(TOOL.portStatus)} lists them.`);
    }
    for (const item of state.ledger.items.filter(entry => entry.rejected)) {
        notices.push(`The author did not accept checklist item "${item.id}": ${clip(item.rejected!.note || "no note", 160)}.`);
    }
    return notices.slice(0, NOTICE_LIMIT);
}

export type Answer = {
    /** One-line notices, from `collectNotices`. */
    notices?: string[];
    /** Comment lines about the data: provenance, caveats, how to page. */
    comments?: string[];
    /** The payload; written as JSON after the comments. */
    data?: unknown;
    /** Or plain text instead of data. */
    body?: string;
};

/** Notices and comments as `# ` lines first, then the data: the shape every tool answers in. */
export function renderAnswer(answer: Answer): string {
    const head = [
        ...(answer.notices ?? []).map(line => `# Ren2Leaf Bridge: ${line}`),
        ...(answer.comments ?? []).map(line => `# ${line}`),
    ];
    const body = answer.body ?? (answer.data === undefined ? "" : JSON.stringify(answer.data, null, 1));
    const textOut = [...head, body].filter(Boolean).join("\n");
    return textOut.length > TEXT_LIMIT
        ? `${textOut.slice(0, TEXT_LIMIT)}\n# (cut at ${TEXT_LIMIT} characters; narrow the query or page with cursor)`
        : textOut;
}

export function voiceSummary(report: VoiceReport): string {
    if (report.voicedLines === 0) return "No voiced lines recorded yet.";
    const stale = report.problems.filter(problem => problem.kind === "stale");
    const unlinked = report.problems.filter(problem => problem.kind === "unlinked");
    const parts = [`${report.linked}/${report.voicedLines} recorded voiced lines have a take`];
    if (stale.length) parts.push(`${stale.length} records are stale (scene rewritten after recording: ${describeRanges(stale)})`);
    if (unlinked.length) parts.push(`${unlinked.length} lines have no take yet (${describeRanges(unlinked)})`);
    if (report.strayTakes) parts.push(`${report.strayTakes} takes sit on lines that no longer exist`);
    return `${parts.join("; ")}.`;
}

export function portStatus(state: BridgeState, voice: VoiceReport | null): string {
    const lines: string[] = [];
    const pack = state.pack;
    if (pack) {
        const size = pack.game.width && pack.game.height ? ` ${pack.game.width}x${pack.game.height}` : "";
        lines.push(`Pack: "${pack.game.name}"${size}, scanned by ${pack.scanner.name} ${pack.scanner.version}, imported ${pack.importedAt}. ${pack.sections.length} README sections, ${pack.shots.length} screenshots. Read sections with ${tool(TOOL.packSection)}, rows with ${tool(TOOL.packQuery)}, screens with ${tool(TOOL.packScreen)}, pictures (crops, speaker portraits) with ${tool(TOOL.packImage)}.`);
    } else {
        lines.push(`Pack: none imported. Stop here: ask the author to import the Ren2Leaf pack from the Ren2Leaf Bridge panel (Choose pack…), and call this again once they have. Do not start porting, and do not ask for the pack folder instead.`);
    }
    lines.push(`Phase: ${state.log.phase ?? "not set (set it with " + tool(TOOL.logNote) + ")"}.`);

    const items = state.ledger.items;
    if (items.length === 0) {
        lines.push(`Checklist: empty. Before porting, list every feature of the original with ${tool(TOOL.ledgerUpsert)}: story, variables, characters, stage, audio, voice, interface, system, extras, python.`);
    } else {
        const counts = new Map<LedgerStatus, number>();
        for (const item of items) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
        const total = LEDGER_STATUSES.filter(status => counts.get(status)).map(status => `${counts.get(status)} ${status}`).join(", ");
        const byArea = LEDGER_AREAS
            .map(area => {
                const inArea = items.filter(item => item.area === area);
                if (!inArea.length) return null;
                const done = inArea.filter(item => item.status === "done").length;
                return `${area} ${done}/${inArea.length}`;
            })
            .filter(Boolean)
            .join(", ");
        lines.push(`Checklist: ${items.length} items (${total}). Done by area: ${byArea}.`);
        const rejected = items.filter(item => item.rejected);
        for (const item of rejected) lines.push(`  Not accepted by the author: ${item.id} - ${item.rejected!.note || "no note"}`);
        const blocked = items.filter(item => item.status === "blocked");
        if (blocked.length) lines.push(`  Blocked: ${blocked.map(item => `${item.id} (on ${item.decisionId})`).join(", ")}`);
    }

    const agentDecisions = state.decisions.items.filter(item => item.origin === "agent");
    const open = agentDecisions.filter(item => item.status === "open");
    const fresh = agentDecisions.filter(item => item.status === "answered" && !item.seenByAgent);
    const packCount = state.decisions.items.filter(item => item.origin === "pack").length;
    lines.push(`Decisions: ${open.length} waiting for the author, ${fresh.length} newly answered, ${packCount} settled by the migrator in the pack.`);
    for (const decision of fresh) lines.push(`  ${decision.id}: ${decision.question} -> ${answerSummary(decision)}`);
    for (const decision of open) lines.push(`  ${decision.id} (open): ${decision.question}`);
    if (fresh.length) lines.push(`  Call ${tool(TOOL.decisionSeen)} with the ids once you have acted on them.`);

    const openIssues = state.issues.items.filter(item => item.status === "open");
    lines.push(`Studio issues recorded: ${openIssues.length} open of ${state.issues.items.length}.`);

    const sceneCount = Object.keys(state.lines.scenes).length;
    const lineCount = Object.values(state.lines.scenes).reduce((sum, scene) => sum + scene.lines.length, 0);
    lines.push(`Line records: ${lineCount} lines in ${sceneCount} scenes.${voice ? ` Voice: ${voiceSummary(voice)}` : ""}`);

    const recent = state.log.entries.slice(-10);
    if (recent.length) {
        lines.push("Recent log:");
        for (const entry of recent) {
            lines.push(`  ${entry.at.slice(0, 16)} ${entry.kind}${entry.topic ? ` [${entry.topic}]` : ""}: ${entry.text}${entry.reason ? ` (because ${entry.reason})` : ""}`);
        }
    }
    return lines.join("\n");
}
