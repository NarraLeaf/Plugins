/**
 * What the player's window shows: a compact heads-up display, and a full panel behind the same
 * hotkey with Shift held.
 *
 * Two things shape every line of this file.
 *
 * **It is styled inline, entirely.** The overlay renders inside the game, whose stylesheet is the
 * one the author's project produced; a plugin bundle contributes no CSS and cannot rely on any
 * class existing. Inline styles are not a shortcut here, they are the only thing that is true in
 * every build.
 *
 * **It is drawn above everything, and that is a deliberate departure.** The host renders plugin
 * overlays between the stage and the app surfaces, which is right for an overlay that belongs to the
 * game - and wrong for a diagnostic one, which would vanish behind the pause menu, the save screen
 * and every authored page. So the tree is portalled to the document body: the host still owns the
 * React element (a plugin has no `react-dom/client` and cannot mount a second root), `createPortal`
 * is exported to plugins for exactly this, and only where the DOM lands changes.
 *
 * Nothing is taken from the game by doing it. The heads-up display is small, cornered and completely
 * transparent to the pointer, and only the full panel - which someone opened on purpose - covers
 * anything or takes a click.
 */

import { Fragment, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { RESOURCE_KINDS, type ResourceRecord } from "./collector";
import type { Profiler } from "./profiler";
import { formatBytes, formatMs } from "./report";
import type { OverlayCorner } from "./settings";
import type { OverlayStrings } from "./strings";

/**
 * Above every layer the game or the host can produce.
 *
 * A number this size is usually a smell, and here it is the requirement: this draws only after
 * someone pressed a key asking to see it, and anything it ends up behind is a measurement they
 * cannot read.
 */
const OVERLAY_Z_INDEX = 2147483000;

const PORTAL_STYLE: CSSProperties = {
    position: "fixed",
    inset: 0,
    zIndex: OVERLAY_Z_INDEX,
    // The frame itself never takes a click; the panel inside it turns this back on for itself.
    pointerEvents: "none",
};

const FONT_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const PANEL_BACKGROUND = "rgba(14, 16, 21, 0.92)";
const PANEL_BORDER = "1px solid rgba(255, 255, 255, 0.14)";
const TEXT = "rgba(236, 239, 244, 0.94)";
const TEXT_DIM = "rgba(236, 239, 244, 0.58)";
const ACCENT = "rgb(126, 200, 255)";
const WARN = "rgb(255, 196, 106)";
const BAD = "rgb(255, 128, 128)";

/** The frame budget a 60Hz display gives, which is what the colours below are judged against. */
const BUDGET_60_MS = 16.67;

const CORNER_STYLES: Record<OverlayCorner, CSSProperties> = {
    "top-left": { top: 12, left: 12 },
    "top-right": { top: 12, right: 12 },
    "bottom-left": { bottom: 12, left: 12 },
    "bottom-right": { bottom: 12, right: 12 },
};

function fpsColour(fps: number): string {
    if (fps >= 55) {
        return ACCENT;
    }
    return fps >= 30 ? WARN : BAD;
}

function useProfiler(profiler: Profiler): number {
    return useSyncExternalStore(
        listener => profiler.subscribe(listener),
        () => profiler.getVersion(),
        () => profiler.getVersion(),
    );
}

type SparklineProps = {
    values: number[];
    width: number;
    height: number;
    /** The value drawn as a guide line, when one is meaningful. */
    reference?: number;
};

/**
 * A series over time, scaled to keep a steady line readable.
 *
 * Two decisions, both about what a chart is allowed to imply.
 *
 * **A series with a reference is scaled against it**, not against its own data: a run comfortably
 * inside the frame budget should look flat, and a chart that always fills its box makes a smooth
 * game and a stuttering one indistinguishable at a glance.
 *
 * **A series without one is scaled to its own range, with headroom at both ends.** A heap that has
 * not moved would otherwise draw along the very top edge with half its stroke clipped, which reads
 * as a broken chart rather than as a steady one.
 */
function Sparkline({ values, width, height, reference }: SparklineProps) {
    if (values.length === 0) {
        return null;
    }
    const highest = Math.max(reference ? reference * 2 : 0, ...values, 1);
    const lowest = reference ? 0 : Math.min(...values);
    const span = Math.max(highest - lowest, highest * 0.08, 1);
    const floor = lowest - span * 0.15;
    const ceiling = highest + span * 0.15;
    const project = (value: number): number => height - ((value - floor) / (ceiling - floor)) * height;
    const step = values.length > 1 ? width / (values.length - 1) : width;
    const points = values
        .map((value, index) => `${(index * step).toFixed(1)},${project(value).toFixed(1)}`)
        .join(" ");
    const referenceY = reference ? project(reference) : null;
    return (
        <svg width={width} height={height} style={{ display: "block" }} aria-hidden="true">
            <polyline points={points} fill="none" stroke={ACCENT} strokeWidth={1} />
            {referenceY !== null ? (
                <line
                    x1={0}
                    x2={width}
                    y1={referenceY}
                    y2={referenceY}
                    stroke="rgba(255,255,255,0.25)"
                    strokeDasharray="3 3"
                    strokeWidth={1}
                />
            ) : null}
        </svg>
    );
}

type HudProps = {
    profiler: Profiler;
    strings: OverlayStrings;
    corner: OverlayCorner;
};

function Hud({ profiler, strings, corner }: HudProps) {
    const stats = profiler.quick();
    const cell = (label: string, value: ReactNode, colour = TEXT): ReactNode => (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <span style={{ color: TEXT_DIM }}>{label}</span>
            <span style={{ color: colour, fontVariantNumeric: "tabular-nums" }}>{value}</span>
        </div>
    );
    return (
        <div
            style={{
                position: "fixed",
                ...CORNER_STYLES[corner],
                minWidth: 168,
                padding: "8px 10px",
                borderRadius: 8,
                background: PANEL_BACKGROUND,
                border: PANEL_BORDER,
                color: TEXT,
                font: `500 11px/1.5 ${FONT_STACK}`,
                // The display reports; it never intercepts. Everything under it stays clickable.
                pointerEvents: "none",
                userSelect: "none",
            }}
        >
            {cell(strings.hudFps, stats.fps.toFixed(1), fpsColour(stats.fps))}
            {cell(strings.hudFrame, `${stats.frameMs.toFixed(1)}ms`)}
            {stats.heapSupported ? cell(strings.hudHeap, formatBytes(stats.heapUsedBytes)) : null}
            {cell(strings.hudHeld, `${stats.retainedBlobs} / ${formatBytes(stats.retainedBytes)}`)}
            {cell(strings.hudLoaded, `${stats.addresses} / ${formatBytes(stats.bytes)}`)}
            {profiler.isRunning() ? null : (
                <div style={{ marginTop: 4, color: WARN, fontSize: 10, whiteSpace: "nowrap" }}>
                    {strings.notMeasuring}
                </div>
            )}
        </div>
    );
}

type TabId = "overview" | "frames" | "assets" | "memory" | "timeline";

type StatProps = {
    label: string;
    value: ReactNode;
    hint?: ReactNode;
};

function Stat({ label, value, hint }: StatProps) {
    return (
        <div style={{ minWidth: 120 }}>
            <div style={{ color: TEXT_DIM, fontSize: 10 }}>{label}</div>
            <div style={{ fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{value}</div>
            {hint ? <div style={{ color: TEXT_DIM, fontSize: 10 }}>{hint}</div> : null}
        </div>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div style={{ marginBottom: 18 }}>
            <div
                style={{
                    color: TEXT_DIM,
                    fontSize: 10,
                    marginBottom: 8,
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    paddingBottom: 4,
                }}
            >
                {title}
            </div>
            {children}
        </div>
    );
}

function StatRow({ children }: { children: ReactNode }) {
    return <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 12 }}>{children}</div>;
}

function ToolbarButton({
    label,
    onClick,
    tone = "normal",
}: {
    label: string;
    onClick: () => void;
    tone?: "normal" | "quiet";
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: PANEL_BORDER,
                background: tone === "quiet" ? "transparent" : "rgba(255,255,255,0.08)",
                color: TEXT,
                font: `500 11px/1.6 ${FONT_STACK}`,
                cursor: "pointer",
            }}
        >
            {label}
        </button>
    );
}

type AssetSort = "bytes" | "requests" | "decode" | "recent";

const MAX_ASSET_ROWS = 200;

function AssetsTab({
    records,
    strings,
    instrumented,
}: {
    records: ResourceRecord[];
    strings: OverlayStrings;
    instrumented: boolean;
}) {
    const [sort, setSort] = useState<AssetSort>("bytes");
    const [filter, setFilter] = useState("");

    const rows = useMemo(() => {
        const needle = filter.trim().toLowerCase();
        const filtered = needle
            ? records.filter(record => record.url.toLowerCase().includes(needle))
            : records;
        const sorted = [...filtered].sort((left, right) => {
            if (sort === "requests") {
                return right.requests - left.requests || right.totalBytes - left.totalBytes;
            }
            if (sort === "decode") {
                return right.decodeMs - left.decodeMs || right.totalBytes - left.totalBytes;
            }
            if (sort === "recent") {
                return right.lastAt - left.lastAt;
            }
            return right.totalBytes - left.totalBytes || right.requests - left.requests;
        });
        return { sorted, total: filtered.length };
    }, [records, sort, filter]);

    const header = (label: string, key: AssetSort): ReactNode => (
        <button
            type="button"
            onClick={() => setSort(key)}
            style={{
                background: "transparent",
                border: "none",
                padding: 0,
                color: sort === key ? ACCENT : TEXT_DIM,
                font: `500 10px/1.6 ${FONT_STACK}`,
                cursor: "pointer",
                textAlign: "right",
            }}
        >
            {label}
        </button>
    );

    return (
        <div>
            {!instrumented ? (
                <div style={{ color: WARN, fontSize: 11, marginBottom: 10 }}>{strings.instrumentationOff}</div>
            ) : null}
            <input
                value={filter}
                onChange={event => setFilter(event.target.value)}
                placeholder={strings.filterPlaceholder}
                style={{
                    width: "100%",
                    boxSizing: "border-box",
                    marginBottom: 10,
                    padding: "5px 8px",
                    borderRadius: 6,
                    border: PANEL_BORDER,
                    background: "rgba(0,0,0,0.35)",
                    color: TEXT,
                    font: `400 11px/1.5 ${FONT_STACK}`,
                }}
            />
            {rows.total === 0 ? (
                <div style={{ color: TEXT_DIM, fontSize: 11 }}>{strings.noAssets}</div>
            ) : (
                <div
                    style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 4.5rem 3.5rem 5rem 4.5rem 3.5rem",
                        gap: "2px 10px",
                        alignItems: "baseline",
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                    }}
                >
                    <div style={{ color: TEXT_DIM, fontSize: 10 }}>{strings.columnAsset}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 10, textAlign: "right" }}>{strings.columnKind}</div>
                    {header(strings.columnRequests, "requests")}
                    {header(strings.columnBytes, "bytes")}
                    {header(strings.columnDecode, "decode")}
                    <div style={{ color: TEXT_DIM, fontSize: 10, textAlign: "right" }}>{strings.columnHeld}</div>
                    {rows.sorted.slice(0, MAX_ASSET_ROWS).map(record => (
                        <Fragment key={record.url}>
                            <div
                                title={record.url}
                                style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                                {record.label}
                            </div>
                            <div style={{ textAlign: "right", color: TEXT_DIM }}>{record.kind}</div>
                            <div style={{ textAlign: "right", color: record.requests > 1 ? WARN : TEXT }}>
                                {record.requests}
                            </div>
                            <div style={{ textAlign: "right" }}>{formatBytes(record.totalBytes)}</div>
                            <div style={{ textAlign: "right", color: TEXT_DIM }}>
                                {record.decodeMs > 0 ? formatMs(record.decodeMs) : "-"}
                            </div>
                            <div style={{ textAlign: "right", color: record.retainedBlobs > 0 ? ACCENT : TEXT_DIM }}>
                                {record.retainedBlobs > 0 ? formatBytes(record.retainedBytes) : "-"}
                            </div>
                        </Fragment>
                    ))}
                </div>
            )}
            {rows.total > MAX_ASSET_ROWS ? (
                <div style={{ color: TEXT_DIM, fontSize: 10, marginTop: 8 }}>
                    {strings.moreRows(rows.total - MAX_ASSET_ROWS)}
                </div>
            ) : null}
        </div>
    );
}

export type PerformanceOverlayProps = {
    profiler: Profiler;
    /**
     * Read as part of rendering rather than passed as a value, so the overlay follows a language
     * switch without the entry having to tear it down and mount it again.
     */
    readStrings: () => OverlayStrings;
};

/** Puts a finished tree on top of the page. See the module comment for why it is not left in place. */
function portalled(content: ReactElement | null): ReactElement | null {
    if (!content) {
        return null;
    }
    const frame = <div style={PORTAL_STYLE}>{content}</div>;
    return typeof document === "undefined" ? frame : createPortal(frame, document.body);
}

export function PerformanceOverlay({ profiler, readStrings }: PerformanceOverlayProps) {
    useProfiler(profiler);
    const strings = readStrings();
    const [tab, setTab] = useState<TabId>("overview");
    const view = profiler.getView();

    if (view === "hidden") {
        return null;
    }
    if (view === "hud") {
        return portalled(<Hud profiler={profiler} strings={strings} corner={profiler.settings.corner} />);
    }

    const snapshot = profiler.snapshot();
    const toast = profiler.currentToast();
    const frames = snapshot.frames;

    const tabs: Array<{ id: TabId; label: string }> = [
        { id: "overview", label: strings.tabOverview },
        { id: "frames", label: strings.tabFrames },
        { id: "assets", label: strings.tabAssets },
        { id: "memory", label: strings.tabMemory },
        { id: "timeline", label: strings.tabTimeline },
    ];

    return portalled(
        <div
            style={{
                position: "fixed",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0, 0, 0, 0.42)",
                // The panel was opened on purpose, so it takes the pointer while it is up.
                pointerEvents: "auto",
                font: `400 12px/1.6 ${FONT_STACK}`,
                color: TEXT,
            }}
            onClick={event => {
                if (event.target === event.currentTarget) {
                    profiler.setView("hidden");
                }
            }}
        >
            <div
                style={{
                    width: "min(940px, calc(100vw - 48px))",
                    height: "min(640px, calc(100vh - 48px))",
                    display: "flex",
                    flexDirection: "column",
                    borderRadius: 12,
                    background: PANEL_BACKGROUND,
                    border: PANEL_BORDER,
                    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
                    overflow: "hidden",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "10px 14px",
                        borderBottom: "1px solid rgba(255,255,255,0.1)",
                    }}
                >
                    <div style={{ fontWeight: 600 }}>{strings.title}</div>
                    <div style={{ color: TEXT_DIM, fontSize: 11 }}>
                        {`${strings.sessionLength} ${formatMs(snapshot.elapsedMs)}`}
                    </div>
                    {profiler.isRunning() ? null : (
                        <div style={{ color: WARN, fontSize: 11 }}>{strings.notMeasuring}</div>
                    )}
                    <div style={{ flex: 1 }} />
                    <ToolbarButton
                        label={strings.copySummary}
                        onClick={() => void profiler.deliver("text", {
                            copied: strings.copied,
                            copyFailed: strings.copyFailed,
                            logged: strings.loggedToGameLog,
                        })}
                    />
                    <ToolbarButton
                        label={strings.copyJson}
                        onClick={() => void profiler.deliver("json", {
                            copied: strings.copied,
                            copyFailed: strings.copyFailed,
                            logged: strings.loggedToGameLog,
                        })}
                    />
                    <ToolbarButton
                        label={strings.logReport}
                        tone="quiet"
                        onClick={() => void profiler.deliver("log", {
                            copied: strings.copied,
                            copyFailed: strings.copyFailed,
                            logged: strings.loggedToGameLog,
                        })}
                    />
                    <ToolbarButton label={strings.resetSession} tone="quiet" onClick={() => profiler.reset()} />
                    <ToolbarButton label={strings.close} tone="quiet" onClick={() => profiler.setView("hidden")} />
                </div>

                <div style={{ display: "flex", gap: 4, padding: "8px 14px 0" }}>
                    {tabs.map(entry => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => setTab(entry.id)}
                            style={{
                                padding: "4px 10px",
                                borderRadius: "6px 6px 0 0",
                                border: "none",
                                borderBottom: `2px solid ${tab === entry.id ? ACCENT : "transparent"}`,
                                background: "transparent",
                                color: tab === entry.id ? TEXT : TEXT_DIM,
                                font: `500 11px/1.6 ${FONT_STACK}`,
                                cursor: "pointer",
                            }}
                        >
                            {entry.label}
                        </button>
                    ))}
                </div>

                {toast ? (
                    <div style={{ padding: "6px 14px 0", color: ACCENT, fontSize: 11 }}>{toast.text}</div>
                ) : null}

                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
                    {tab === "overview" ? (
                        <div>
                            <StatRow>
                                <Stat
                                    label={strings.framesRecent}
                                    value={<span style={{ color: fpsColour(frames.fps) }}>{`${frames.fps} fps`}</span>}
                                    hint={`${strings.framesAverage} ${frames.avgFps} fps`}
                                />
                                <Stat
                                    label={strings.framePercentiles}
                                    value={`${frames.p50Ms}ms`}
                                    hint={`p95 ${frames.p95Ms}ms - p99 ${frames.p99Ms}ms`}
                                />
                                <Stat label={strings.hitches} value={frames.hitches} hint={`${strings.stalls}: ${frames.stalls}`} />
                                <Stat
                                    label={strings.heapUsed}
                                    value={snapshot.heap.supported ? formatBytes(snapshot.heap.usedBytes) : "-"}
                                    hint={snapshot.heap.supported
                                        ? `${strings.heapPeak} ${formatBytes(snapshot.heap.peakBytes)}`
                                        : strings.notMeasured}
                                />
                                <Stat
                                    label={strings.heldInMemory}
                                    value={formatBytes(snapshot.retained.bytes)}
                                    hint={strings.objectUrlCount(snapshot.retained.blobs)}
                                />
                            </StatRow>
                            <Section title={strings.assetsSummary}>
                                <StatRow>
                                    <Stat
                                        label={strings.transferred}
                                        value={formatBytes(snapshot.resources.totals.bytes)}
                                        hint={`${strings.addressCount(snapshot.resources.totals.addresses)} - ${strings.requestCount(snapshot.resources.totals.requests)}`}
                                    />
                                    <Stat
                                        label={strings.repeatFetches}
                                        value={formatBytes(snapshot.resources.totals.repeatBytes)}
                                    />
                                    <Stat label={strings.decodeTime} value={formatMs(snapshot.resources.totals.decodeMs)} />
                                    <Stat label={strings.failedRequests} value={snapshot.resources.totals.failed} />
                                </StatRow>
                            </Section>
                            <Section title={strings.playthrough}>
                                <StatRow>
                                    <Stat label={strings.scenes} value={snapshot.counters.scenesEntered} />
                                    <Stat label={strings.lines} value={snapshot.counters.dialogueLines} />
                                    <Stat label={strings.choices} value={snapshot.counters.choices} />
                                    <Stat label={strings.saves} value={snapshot.counters.savesWritten} />
                                </StatRow>
                            </Section>
                            {snapshot.spans.length > 0 || snapshot.openSpans.length > 0 ? (
                                <Section title={strings.spans}>
                                    {snapshot.spans.slice(-12).reverse().map(span => (
                                        <div key={`${span.name}-${span.startAt}`} style={{ display: "flex", gap: 12 }}>
                                            <span style={{ flex: 1 }}>{span.name}</span>
                                            <span style={{ fontVariantNumeric: "tabular-nums" }}>
                                                {formatMs(span.durationMs)}
                                            </span>
                                        </div>
                                    ))}
                                    {snapshot.openSpans.length > 0 ? (
                                        <div style={{ color: TEXT_DIM, marginTop: 6 }}>
                                            {`${strings.openSpans}: ${snapshot.openSpans.join(", ")}`}
                                        </div>
                                    ) : null}
                                </Section>
                            ) : null}
                        </div>
                    ) : null}

                    {tab === "frames" ? (
                        <div>
                            <StatRow>
                                <Stat label={strings.framesRecent} value={`${frames.fps} fps`} />
                                <Stat label={strings.framesAverage} value={`${frames.avgFps} fps`} />
                                <Stat label="p50" value={`${frames.p50Ms}ms`} />
                                <Stat label="p95" value={`${frames.p95Ms}ms`} />
                                <Stat label="p99" value={`${frames.p99Ms}ms`} />
                                <Stat label="max" value={`${frames.worstMs}ms`} />
                            </StatRow>
                            <Section title={strings.framePercentiles}>
                                <Sparkline values={frames.recentMs} width={880} height={90} reference={BUDGET_60_MS} />
                                <div style={{ color: TEXT_DIM, fontSize: 10, marginTop: 4 }}>
                                    {`${strings.frameCount(frames.recentMs.length)} - ${strings.budgetLine(Number(BUDGET_60_MS.toFixed(1)))}`}
                                </div>
                            </Section>
                            <Section title={strings.longTasks}>
                                {snapshot.longTasks.supported ? (
                                    <StatRow>
                                        <Stat label={strings.longTasks} value={snapshot.longTasks.count} />
                                        <Stat label={strings.blockingTime} value={formatMs(snapshot.longTasks.blockingMs)} />
                                        <Stat label="max" value={`${snapshot.longTasks.worstMs}ms`} />
                                    </StatRow>
                                ) : (
                                    <div style={{ color: TEXT_DIM }}>{strings.notMeasured}</div>
                                )}
                            </Section>
                            <Section title={strings.overhead}>
                                <div style={{ color: TEXT_DIM }}>
                                    {strings.overheadPerFrame(snapshot.overhead.averageMs, snapshot.overhead.frames)}
                                </div>
                            </Section>
                        </div>
                    ) : null}

                    {tab === "assets" ? (
                        <AssetsTab
                            records={snapshot.resources.records}
                            strings={strings}
                            instrumented={snapshot.resources.instrumented}
                        />
                    ) : null}

                    {tab === "memory" ? (
                        <div>
                            <StatRow>
                                <Stat
                                    label={strings.heapUsed}
                                    value={snapshot.heap.supported ? formatBytes(snapshot.heap.usedBytes) : "-"}
                                    hint={snapshot.heap.supported ? undefined : strings.notMeasured}
                                />
                                <Stat
                                    label={strings.heapPeak}
                                    value={snapshot.heap.supported ? formatBytes(snapshot.heap.peakBytes) : "-"}
                                />
                                <Stat
                                    label={strings.heapLimit}
                                    value={snapshot.heap.supported ? formatBytes(snapshot.heap.limitBytes) : "-"}
                                />
                            </StatRow>
                            {snapshot.heap.supported ? (
                                <Section title={strings.heapUsed}>
                                    <Sparkline values={snapshot.heap.recentUsedBytes} width={880} height={70} />
                                </Section>
                            ) : null}
                            <Section title={strings.heldInMemory}>
                                <div style={{ color: TEXT_DIM, marginBottom: 8 }}>{strings.heldExplain}</div>
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "8rem 5rem 7rem",
                                        gap: "2px 12px",
                                        fontVariantNumeric: "tabular-nums",
                                    }}
                                >
                                    {RESOURCE_KINDS.filter(kind => snapshot.retained.byKind[kind].blobs > 0).map(kind => (
                                        <Fragment key={kind}>
                                            <div>{kind}</div>
                                            <div style={{ textAlign: "right" }}>{snapshot.retained.byKind[kind].blobs}</div>
                                            <div style={{ textAlign: "right" }}>
                                                {formatBytes(snapshot.retained.byKind[kind].bytes)}
                                            </div>
                                        </Fragment>
                                    ))}
                                    <div style={{ fontWeight: 600 }}>{strings.total}</div>
                                    <div style={{ textAlign: "right", fontWeight: 600 }}>{snapshot.retained.blobs}</div>
                                    <div style={{ textAlign: "right", fontWeight: 600 }}>
                                        {formatBytes(snapshot.retained.bytes)}
                                    </div>
                                </div>
                            </Section>
                        </div>
                    ) : null}

                    {tab === "timeline" ? (
                        <div>
                            {snapshot.markers.length === 0 ? (
                                <div style={{ color: TEXT_DIM }}>{strings.noTimeline}</div>
                            ) : (
                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "5.5rem 5rem minmax(0, 1fr)",
                                        gap: "1px 12px",
                                        fontVariantNumeric: "tabular-nums",
                                        fontSize: 11,
                                    }}
                                >
                                    {[...snapshot.markers].reverse().map((marker, index) => (
                                        <Fragment key={`${marker.at}-${marker.label}-${index}`}>
                                            <div style={{ textAlign: "right", color: TEXT_DIM }}>{formatMs(marker.at)}</div>
                                            <div style={{ color: TEXT_DIM }}>{marker.kind}</div>
                                            <div>
                                                {marker.label}
                                                {marker.detail ? (
                                                    <span style={{ color: TEXT_DIM }}>{` ${marker.detail}`}</span>
                                                ) : null}
                                            </div>
                                        </Fragment>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : null}
                </div>

                {snapshot.resources.droppedAddresses > 0 || snapshot.droppedMarkers > 0 ? (
                    <div
                        style={{
                            padding: "6px 14px",
                            borderTop: "1px solid rgba(255,255,255,0.1)",
                            color: WARN,
                            fontSize: 10,
                        }}
                    >
                        {snapshot.resources.droppedAddresses > 0
                            ? `${strings.cappedAddresses(snapshot.resources.droppedAddresses)} `
                            : ""}
                        {snapshot.droppedMarkers > 0 ? strings.droppedTimeline : ""}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
