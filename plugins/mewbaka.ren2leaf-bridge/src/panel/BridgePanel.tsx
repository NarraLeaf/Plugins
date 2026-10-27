/**
 * The author's side of the port: the pack, the agent's questions, the feature checklist and the
 * Studio issues. Built from Studio's `ui` kit with inline layout only - a third-party plugin cannot
 * add Tailwind classes to Studio's stylesheet, so a class Studio does not already use does nothing.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { ui, type PluginApp, type PluginTranslator } from "narraleaf-studio/plugin";
import { importPack, LARGE_INVENTORY_BYTES } from "../actions";
import { answerDecision, answerSummary, rejectLedgerItem, setIssueStatus, upsertLedger, withdrawDecision } from "../model";
import type { BridgeStore } from "../store";
import { LEDGER_AREAS, LEDGER_STATUSES, type Decision, type Issue, type LedgerItem, type SourceRef } from "../types";

type Tab = "overview" | "decisions" | "ledger" | "issues";

type Ctx = { app: PluginApp; store: BridgeStore; t: PluginTranslator["t"]; frozen: boolean };

const column: CSSProperties = { display: "flex", flexDirection: "column", gap: 8 };
const row: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" };
const quiet: CSSProperties = { opacity: 0.7, fontSize: 12 };
const block: CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12 };

function sources(refs: SourceRef[]): string {
    return refs.map(ref => (ref.line ? `${ref.file}:${ref.line}` : ref.file)).join(", ");
}

async function attempt(app: PluginApp, work: () => Promise<void>): Promise<void> {
    try {
        await work();
    } catch (error) {
        app.services.ui.notifications.error(error instanceof Error ? error.message : String(error));
    }
}

export function BridgePanel({ app, store, translator }: { app: PluginApp; store: BridgeStore; translator: PluginTranslator }) {
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    const [, setLocale] = useState(translator.locale);
    useEffect(() => {
        const stop = app.services.i18n.onLocaleChange(setLocale);
        return () => void stop();
    }, [app]);
    const guard = ui.useFreezeGuard();
    const [tab, setTab] = useState<Tab>("overview");
    const ctx: Ctx = { app, store, t: translator.t.bind(translator), frozen: guard.frozen };
    const open = state.decisions.items.filter(item => item.origin === "agent" && item.status === "open").length;

    const tabs: { id: Tab; label: string }[] = [
        { id: "overview", label: ctx.t("tab.overview") },
        { id: "decisions", label: open ? `${ctx.t("tab.decisions")} (${open})` : ctx.t("tab.decisions") },
        { id: "ledger", label: ctx.t("tab.ledger") },
        { id: "issues", label: ctx.t("tab.issues") },
    ];

    return (
        <ui.Panel.Root>
            <ui.Panel.Toolbar>
                <div style={row}>
                    {tabs.map(entry => (
                        <ui.Button key={entry.id} size="sm" variant={tab === entry.id ? "secondary" : "ghost"} onClick={() => setTab(entry.id)}>
                            {entry.label}
                        </ui.Button>
                    ))}
                </div>
            </ui.Panel.Toolbar>
            {tab === "overview" && <Overview ctx={ctx} />}
            {tab === "decisions" && <Decisions ctx={ctx} />}
            {tab === "ledger" && <Ledger ctx={ctx} />}
            {tab === "issues" && <Issues ctx={ctx} />}
        </ui.Panel.Root>
    );
}

// ── Overview ────────────────────────────────────────────────────────────────────────────────────

/** `webkitdirectory` is not in React's input props; it turns the file input into a folder picker. */
const folderInput = { webkitdirectory: "" } as Record<string, string>;

function ImportButton({ ctx, again }: { ctx: Ctx; again: boolean }) {
    const { app, store, t } = ctx;
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const run = (files: FileList | null) => attempt(app, async () => {
        if (!files?.length) return;
        setBusy(true);
        try {
            const outcome = await importPack(store, files);
            app.services.ui.notifications.success(t("pack.imported.ok", { game: outcome.game, sections: outcome.sections, shots: outcome.shots }));
            if (outcome.inventoryBytes > LARGE_INVENTORY_BYTES) {
                app.services.ui.notifications.warning(t("pack.imported.large", { size: (outcome.inventoryBytes / 1048576).toFixed(1) }));
            }
        } finally {
            setBusy(false);
        }
    });
    return (
        <>
            <ui.Button size="sm" variant={again ? "secondary" : "primary"} disabled={busy || ctx.frozen} onClick={() => input.current?.click()}>
                {busy ? t("pack.importing") : again ? t("pack.reimport") : t("pack.pick")}
            </ui.Button>
            <input ref={input} type="file" hidden {...folderInput} onChange={event => {
                const files = event.currentTarget.files;
                void run(files).finally(() => {
                    if (input.current) input.current.value = "";
                });
            }} />
        </>
    );
}

function Overview({ ctx }: { ctx: Ctx }) {
    const { store, t } = ctx;
    const state = store.snapshot;
    const pack = state.pack;
    if (!pack) {
        return (
            <ui.Panel.EmptyState title={t("pack.none.title")} description={t("pack.none.description")} actions={<ImportButton ctx={ctx} again={false} />} />
        );
    }
    const items = state.ledger.items;
    const open = state.decisions.items.filter(item => item.origin === "agent" && item.status === "open").length;
    const openIssues = state.issues.items.filter(item => item.status === "open").length;
    return (
        <>
            <ui.Panel.Section title={t("pack.section")}>
                <ui.Panel.Row label={t("pack.game")} control={<span>{pack.game.name}{pack.game.width ? ` · ${pack.game.width}×${pack.game.height}` : ""}</span>} />
                <ui.Panel.Row label={t("pack.scanner")} control={<span>{pack.scanner.name} {pack.scanner.version}</span>} />
                <ui.Panel.Row label={t("pack.contents")} control={<span>{t("pack.contentsValue", { sections: pack.sections.length, shots: pack.shots.length })}</span>} />
                <ui.Panel.Row label={t("pack.imported")} control={<span>{ctx.app.services.i18n.formatDate(new Date(pack.importedAt), { dateStyle: "medium", timeStyle: "short" })}</span>} />
                <ui.Panel.Row label={t("pack.folder")} description={pack.sourcePath} />
                <div style={row}>
                    <ImportButton ctx={ctx} again />
                </div>
            </ui.Panel.Section>
            <ui.Panel.Section title={t("progress.section")}>
                <ui.Panel.Row label={t("progress.phase")} control={<span>{state.log.phase ?? t("progress.phaseUnset")}</span>} />
                <ui.Panel.Row label={t("progress.waiting")} control={<span>{t("progress.waitingValue", { count: open })}</span>} />
                <ui.Panel.Row label={t("progress.issues")} control={<span>{t("progress.issuesValue", { open: openIssues, total: state.issues.items.length })}</span>} />
                {items.length === 0
                    ? <div style={quiet}>{t("progress.emptyLedger")}</div>
                    : LEDGER_AREAS.map(area => {
                        const inArea = items.filter(item => item.area === area);
                        if (!inArea.length) return null;
                        const done = inArea.filter(item => item.status === "done").length;
                        return (
                            <div key={area} style={column}>
                                <div style={{ ...row, justifyContent: "space-between", fontSize: 12 }}>
                                    <span>{t(`area.${area}`)}</span>
                                    <span>{done} / {inArea.length}</span>
                                </div>
                                <ui.Progress value={done} max={inArea.length} size="sm" variant={done === inArea.length ? "success" : "default"} />
                            </div>
                        );
                    })}
            </ui.Panel.Section>
        </>
    );
}

// ── Decisions ───────────────────────────────────────────────────────────────────────────────────

function AnswerForm({ ctx, decision, onDone }: { ctx: Ctx; decision: Decision; onDone?: () => void }) {
    const { app, store, t } = ctx;
    const [words, setWords] = useState(decision.answer?.text ?? "");
    const submit = (answer: { optionId?: string; text?: string }) => attempt(app, async () => {
        await store.write({ decisions: answerDecision(store.snapshot.decisions, decision.id, answer, new Date().toISOString()) });
        onDone?.();
    });
    return (
        <div style={column}>
            {decision.options.map(option => (
                <div key={option.id} style={column}>
                    <ui.Button size="sm" variant={decision.recommended === option.id ? "primary" : "secondary"} disabled={ctx.frozen}
                        onClick={() => submit({ optionId: option.id, text: words.trim() || undefined })}>
                        {`${option.id}) ${option.label}${decision.recommended === option.id ? ` · ${t("decisions.recommended")}` : ""}`}
                    </ui.Button>
                    {option.consequence && <div style={quiet}>{option.consequence}</div>}
                </div>
            ))}
            <ui.TextArea size="sm" fullWidth rows={2} placeholder={t("decisions.own")} value={words} disabled={ctx.frozen}
                onChange={event => setWords(event.target.value)} />
            <div style={row}>
                <ui.Button size="sm" variant="ghost" disabled={ctx.frozen || !words.trim()} onClick={() => submit({ text: words.trim() })}>
                    {t("decisions.submit")}
                </ui.Button>
            </div>
        </div>
    );
}

function DecisionCard({ ctx, decision }: { ctx: Ctx; decision: Decision }) {
    const { app, store, t } = ctx;
    const [editing, setEditing] = useState(decision.status === "open");
    useEffect(() => setEditing(decision.status === "open"), [decision.status]);
    return (
        <ui.Card size="sm" variant="outlined">
            <div style={column}>
                <div style={{ fontWeight: 600 }}>{decision.id} · {decision.question}</div>
                {decision.context && <div style={block}>{decision.context}</div>}
                {decision.source.length > 0 && <div style={quiet}>{t("decisions.source")}: {sources(decision.source)}</div>}
                {decision.status === "answered" && !editing && (
                    <>
                        <div style={block}>{answerSummary(decision)}</div>
                        {!decision.seenByAgent && <div style={quiet}>{t("decisions.unread")}</div>}
                        {decision.origin === "agent" && (
                            <div style={row}>
                                <ui.Button size="sm" variant="ghost" disabled={ctx.frozen} onClick={() => setEditing(true)}>{t("decisions.change")}</ui.Button>
                            </div>
                        )}
                    </>
                )}
                {editing && decision.origin === "agent" && <AnswerForm ctx={ctx} decision={decision} onDone={() => setEditing(false)} />}
                {decision.status === "open" && (
                    <div style={row}>
                        <ui.Button size="sm" variant="ghost" disabled={ctx.frozen}
                            onClick={() => attempt(app, () => store.write({ decisions: withdrawDecision(store.snapshot.decisions, decision.id) }))}>
                            {t("decisions.withdraw")}
                        </ui.Button>
                    </div>
                )}
            </div>
        </ui.Card>
    );
}

function Decisions({ ctx }: { ctx: Ctx }) {
    const { store, t } = ctx;
    const items = store.snapshot.decisions.items;
    const open = items.filter(item => item.origin === "agent" && item.status === "open");
    const answered = items.filter(item => item.origin === "agent" && item.status === "answered").reverse();
    const fromPack = items.filter(item => item.origin === "pack");
    return (
        <>
            <ui.Panel.Section title={t("decisions.open")}>
                {open.length === 0 ? <div style={quiet}>{t("decisions.none")}</div> : open.map(decision => <DecisionCard key={decision.id} ctx={ctx} decision={decision} />)}
            </ui.Panel.Section>
            {answered.length > 0 && (
                <ui.Panel.Section title={t("decisions.answered")}>
                    {answered.map(decision => <DecisionCard key={decision.id} ctx={ctx} decision={decision} />)}
                </ui.Panel.Section>
            )}
            {fromPack.length > 0 && (
                <ui.Panel.Section title={t("decisions.pack")}>
                    {fromPack.map(decision => (
                        <div key={decision.id} style={column}>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{decision.question}</div>
                            <div style={block}>{decision.answer?.text}</div>
                        </div>
                    ))}
                </ui.Panel.Section>
            )}
        </>
    );
}

// ── Checklist ───────────────────────────────────────────────────────────────────────────────────

function LedgerCard({ ctx, item }: { ctx: Ctx; item: LedgerItem }) {
    const { app, store, t } = ctx;
    const [rejecting, setRejecting] = useState(false);
    const [note, setNote] = useState("");
    // The author moves an item along; blocked and dropped are tied to decisions and stay the agent's.
    const statusOptions = (["todo", "doing", "done"] as const).map(status => ({ value: status, label: t(`status.${status}`) }));
    const setStatus = (status: string) => attempt(app, async () => {
        const state = store.snapshot;
        const result = upsertLedger(state.ledger, state.decisions, [{ id: item.id, status }], "author", new Date().toISOString());
        await store.write({ ledger: result.ledger });
    });
    const reject = () => attempt(app, async () => {
        await store.write({ ledger: rejectLedgerItem(store.snapshot.ledger, item.id, note, new Date().toISOString()) });
        setRejecting(false);
        setNote("");
    });
    const fixed = item.status === "blocked" || item.status === "dropped";
    return (
        <ui.Card size="sm" variant="outlined">
            <div style={column}>
                <div style={{ ...row, justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 600, minWidth: 0 }}>{item.title}</span>
                    {fixed
                        ? <span style={quiet}>{t(`status.${item.status}`)}{item.decisionId ? ` · ${item.decisionId}` : ""}</span>
                        : <ui.Select size="sm" options={statusOptions} value={item.status} disabled={ctx.frozen} ariaLabel={t("ledger.filter")} portalMenu
                            onChange={value => setStatus(String(value))} />}
                </div>
                {item.rejected && <div style={{ ...block, fontWeight: 600 }}>{t("ledger.rejected", { note: item.rejected.note })}</div>}
                <div style={block}><span style={quiet}>{t("ledger.plan")}: </span>{item.plan}</div>
                {item.where && <div style={block}><span style={quiet}>{t("ledger.where")}: </span>{item.where}</div>}
                {item.source.length > 0 && <div style={quiet}>{t("ledger.source")}: {sources(item.source)}</div>}
                {item.note && <div style={block}><span style={quiet}>{t("ledger.note")}: </span>{item.note}</div>}
                {item.status === "done" && !rejecting && (
                    <div style={row}>
                        <ui.Button size="sm" variant="ghost" disabled={ctx.frozen} onClick={() => setRejecting(true)}>{t("ledger.reject")}</ui.Button>
                    </div>
                )}
                {rejecting && (
                    <div style={column}>
                        <ui.TextArea size="sm" fullWidth rows={2} placeholder={t("ledger.rejectNote")} value={note} onChange={event => setNote(event.target.value)} />
                        <div style={row}>
                            <ui.Button size="sm" variant="danger" disabled={ctx.frozen || !note.trim()} onClick={reject}>{t("ledger.rejectConfirm")}</ui.Button>
                            <ui.Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>{t("ledger.cancel")}</ui.Button>
                        </div>
                    </div>
                )}
            </div>
        </ui.Card>
    );
}

function Ledger({ ctx }: { ctx: Ctx }) {
    const { store, t } = ctx;
    const [filter, setFilter] = useState<string>("all");
    const items = store.snapshot.ledger.items.filter(item => filter === "all" || item.status === filter);
    const options = [{ value: "all", label: t("ledger.all") }, ...LEDGER_STATUSES.map(status => ({ value: status, label: t(`status.${status}`) }))];
    const groups: ReactNode[] = [];
    for (const area of LEDGER_AREAS) {
        const inArea = items.filter(item => item.area === area);
        if (!inArea.length) continue;
        groups.push(
            <ui.Panel.Section key={area} title={`${t(`area.${area}`)} · ${inArea.length}`}>
                {inArea.map(item => <LedgerCard key={item.id} ctx={ctx} item={item} />)}
            </ui.Panel.Section>,
        );
    }
    return (
        <>
            <ui.Panel.Section>
                <ui.Panel.Row label={t("ledger.filter")} control={<ui.Select size="sm" options={options} value={filter} inspectOnly portalMenu ariaLabel={t("ledger.filter")} onChange={value => setFilter(String(value))} />} />
            </ui.Panel.Section>
            {groups.length ? groups : <ui.Panel.Section><div style={quiet}>{t("ledger.empty")}</div></ui.Panel.Section>}
        </>
    );
}

// ── Issues ──────────────────────────────────────────────────────────────────────────────────────

function issueMarkdown(issues: Issue[], t: Ctx["t"]): string {
    return issues.map(issue => {
        const lines = [`### ${issue.id} ${issue.title} (${t(`severity.${issue.severity}`)})`];
        if (issue.tool) lines.push(`- ${t("issues.tool")}: \`${issue.tool}\`${issue.args ? ` \`${issue.args}\`` : ""}`);
        if (issue.error) lines.push(`- ${t("issues.error")}: ${issue.error}`);
        if (issue.expected) lines.push(`- ${t("issues.expected")}: ${issue.expected}`);
        if (issue.workaround) lines.push(`- ${t("issues.workaround")}: ${issue.workaround}`);
        return lines.join("\n");
    }).join("\n\n");
}

function Issues({ ctx }: { ctx: Ctx }) {
    const { app, store, t } = ctx;
    const rank = { blocker: 0, major: 1, minor: 2 } as const;
    const issues = [...store.snapshot.issues.items].sort((a, b) =>
        Number(a.status === "resolved") - Number(b.status === "resolved") || rank[a.severity] - rank[b.severity]);
    if (!issues.length) return <ui.Panel.Section><div style={quiet}>{t("issues.none")}</div></ui.Panel.Section>;
    const copy = () => attempt(app, async () => {
        const open = issues.filter(issue => issue.status === "open");
        await navigator.clipboard.writeText(issueMarkdown(open, t));
        app.services.ui.notifications.success(t("issues.copied", { count: open.length }));
    });
    return (
        <ui.Panel.Section actions={<ui.Button size="sm" variant="ghost" onClick={copy}>{t("issues.copy")}</ui.Button>}>
            {issues.map(issue => (
                <ui.Card key={issue.id} size="sm" variant="outlined">
                    <div style={{ ...column, opacity: issue.status === "resolved" ? 0.6 : 1 }}>
                        <div style={{ fontWeight: 600 }}>{issue.id} · {issue.title} · {t(`severity.${issue.severity}`)}</div>
                        {issue.tool && <div style={block}><span style={quiet}>{t("issues.tool")}: </span>{issue.tool}{issue.args ? ` ${issue.args}` : ""}</div>}
                        {issue.error && <div style={block}><span style={quiet}>{t("issues.error")}: </span>{issue.error}</div>}
                        {issue.expected && <div style={block}><span style={quiet}>{t("issues.expected")}: </span>{issue.expected}</div>}
                        {issue.workaround && <div style={block}><span style={quiet}>{t("issues.workaround")}: </span>{issue.workaround}</div>}
                        <div style={row}>
                            <ui.Button size="sm" variant="ghost" disabled={ctx.frozen}
                                onClick={() => attempt(app, () => store.write({ issues: setIssueStatus(store.snapshot.issues, issue.id, issue.status === "open" ? "resolved" : "open") }))}>
                                {issue.status === "open" ? t("issues.resolve") : t("issues.reopen")}
                            </ui.Button>
                        </div>
                    </div>
                </ui.Card>
            ))}
        </ui.Panel.Section>
    );
}
