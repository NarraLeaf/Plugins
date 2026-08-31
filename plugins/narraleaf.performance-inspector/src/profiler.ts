/**
 * The object everything else talks to: the collector, the probes and the overlay's state, wired
 * together and given a lifetime.
 *
 * It is the only stateful thing the runtime entry constructs, and it is deliberately ignorant of
 * both ends. It does not know what a NarraLeaf event is - the entry translates those into marks and
 * counts - and it does not render anything; the overlay reads it through
 * `subscribe`/`getVersion`/`quick`/`snapshot` like any external store.
 *
 * The one piece of policy here is when it ticks. While the overlay is hidden the profiler keeps
 * collecting and stops notifying, because a re-render four times a second for a panel nobody is
 * looking at is exactly the kind of cost a profiler should not add.
 */

import {
    PerformanceCollector,
    type CollectorCounters,
    type CollectorSnapshot,
    type QuickStats,
    type TimelineMarkerKind,
} from "./collector";
import { describeEnvironment, type EnvironmentScope } from "./environment";
import { installProbes, type ProbeScope, type ProbeTeardown } from "./probes";
import {
    buildReport,
    formatReportJson,
    formatReportText,
    type PerformanceReport,
} from "./report";
import type { InspectorSettings, OverlayView } from "./settings";

export type ProfilerLogLevel = "info" | "warning" | "error";

/** The bits of the host a profiler needs, named so a test can supply them without a game. */
export type ProfilerHost = {
    log(level: ProfilerLogLevel, message: string): void;
    /** Plugin-scoped persistence, when the manifest asked for `store`. */
    persist?: (key: string, value: unknown) => void;
    /** The clipboard, when this shell has one. Rejecting is an ordinary outcome, not an error. */
    writeClipboard?: (text: string) => Promise<void>;
    /** The game's display language, when the manifest asked for `locale`. */
    readLocale?: () => string | undefined;
};

export type ProfilerOptions = {
    settings: InspectorSettings;
    /** The browser. One object so the probes and the environment reading cannot disagree about it. */
    scope: ProbeScope & EnvironmentScope;
    host: ProfilerHost;
    pluginVersion: string;
    /** The monotonic clock. */
    now: () => number;
    /** Wall-clock milliseconds, for the one timestamp a report states in human terms. */
    epochNow: () => number;
};

/** A short line under the panel's toolbar saying what the last button did. */
export type ProfilerToast = {
    text: string;
    /** Monotonic time after which the line stops being shown. */
    until: number;
};

/** How often the overlay is asked to re-render while it is up. */
const TICK_MS = 250;
const TOAST_MS = 4000;

/** The key the last captured report is kept under, so it outlives the run that produced it. */
export const LAST_REPORT_STORE_KEY = "lastReport";

export class Profiler {
    private readonly options: ProfilerOptions;
    private readonly collector: PerformanceCollector;
    private readonly listeners = new Set<() => void>();

    private teardown: ProbeTeardown | null = null;
    private view: OverlayView;
    private version = 0;
    private ticker: unknown = null;
    private toast: ProfilerToast | null = null;
    private cachedSnapshot: { version: number; value: CollectorSnapshot } | null = null;
    private lastReport: PerformanceReport | null = null;

    public constructor(options: ProfilerOptions) {
        this.options = options;
        this.view = options.settings.openAt;
        this.collector = new PerformanceCollector({
            historySeconds: options.settings.historySeconds,
            startedAtEpochMs: options.epochNow(),
            now: options.now,
        });
    }

    public get settings(): InspectorSettings {
        return this.options.settings;
    }

    /** Installs the probes and starts the clock. Idempotent. */
    public start(): void {
        if (this.teardown) {
            return;
        }
        this.teardown = installProbes({
            scope: this.options.scope,
            collector: this.collector,
            instrumentAssets: this.options.settings.instrumentAssets,
        });
        this.collector.mark("profiler", "profiler started");
        this.syncTicker();
    }

    /** Removes everything this installed. The collected numbers stay readable. */
    public stop(): void {
        this.teardown?.();
        this.teardown = null;
        this.stopTicker();
    }

    public getView(): OverlayView {
        return this.view;
    }

    public setView(view: OverlayView): void {
        if (this.view === view) {
            return;
        }
        this.view = view;
        this.collector.mark("profiler", `overlay ${view}`);
        this.syncTicker();
        this.notify();
    }

    /** The configured chord: show the compact display, or put it away again. */
    public toggleHud(): void {
        this.setView(this.view === "hidden" ? "hud" : "hidden");
    }

    /** The chord with Shift: open the full panel, or put it away again. */
    public toggleInspector(): void {
        this.setView(this.view === "inspector" ? "hidden" : "inspector");
    }

    public subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /** The value React watches. Changes whenever anything the overlay draws has moved. */
    public getVersion(): number {
        return this.version;
    }

    public quick(): QuickStats {
        return this.collector.quick();
    }

    /**
     * The full reading, memoized against the tick.
     *
     * Several panels want it in one render and it sorts the whole frame history to get its
     * percentiles, so computing it once per notification and handing the same object to all of them
     * is both cheaper and more coherent - two panels in one frame cannot show two different numbers.
     */
    public snapshot(): CollectorSnapshot {
        if (this.cachedSnapshot?.version === this.version) {
            return this.cachedSnapshot.value;
        }
        const value = this.collector.snapshot();
        this.cachedSnapshot = { version: this.version, value };
        return value;
    }

    public currentToast(): ProfilerToast | null {
        if (!this.toast) {
            return null;
        }
        return this.options.now() < this.toast.until ? this.toast : null;
    }

    public mark(kind: TimelineMarkerKind, label: string, detail?: string): void {
        this.collector.mark(kind, label, detail);
    }

    public count(counter: keyof CollectorCounters, by = 1): void {
        this.collector.count(counter, by);
    }

    public beginSpan(name: string): void {
        this.collector.beginSpan(name);
    }

    public endSpan(name: string): number | null {
        return this.collector.endSpan(name);
    }

    /** Throws away the measurements and keeps the wiring. See `PerformanceCollector.reset`. */
    public reset(): void {
        this.collector.reset(this.options.epochNow());
        this.cachedSnapshot = null;
        this.notify();
    }

    /**
     * Take a report.
     *
     * The report is kept in memory and, when the plugin has storage, written under one key so it
     * survives the process that produced it - a game that crashed is exactly when the last capture
     * matters, and it is also the only way a report leaves a shipped build without a clipboard.
     */
    public capture(): PerformanceReport {
        this.version += 1;
        this.cachedSnapshot = null;
        const report = buildReport({
            snapshot: this.collector.snapshot(),
            environment: describeEnvironment(this.options.scope),
            pluginVersion: this.options.pluginVersion,
            capturedAtEpochMs: this.options.epochNow(),
            locale: this.options.host.readLocale?.(),
        });
        this.lastReport = report;
        this.options.host.persist?.(LAST_REPORT_STORE_KEY, report);
        if (this.options.settings.logOnCapture) {
            this.options.host.log("info", formatReportText(report));
        }
        this.notify();
        return report;
    }

    public getLastReport(): PerformanceReport | null {
        return this.lastReport;
    }

    /**
     * Put a report where someone can use it.
     *
     * The clipboard is the good answer and it is not always there: a shell may withhold it, and a
     * browser refuses it outside a user gesture. So a failed copy falls back to the game log, which
     * on a packaged build is a file on disk, and says which of the two happened rather than
     * reporting success on a copy that did not occur.
     */
    public async deliver(
        kind: "json" | "text" | "log",
        messages: { copied: string; copyFailed: string; logged: string },
    ): Promise<void> {
        const report = this.capture();
        const text = kind === "json" ? formatReportJson(report) : formatReportText(report);
        if (kind === "log") {
            this.options.host.log("info", text);
            this.showToast(messages.logged);
            return;
        }
        const write = this.options.host.writeClipboard;
        if (!write) {
            this.options.host.log("info", text);
            this.showToast(messages.copyFailed);
            return;
        }
        try {
            await write(text);
            this.showToast(messages.copied);
        } catch {
            this.options.host.log("info", text);
            this.showToast(messages.copyFailed);
        }
    }

    private showToast(text: string): void {
        this.toast = { text, until: this.options.now() + TOAST_MS };
        this.notify();
    }

    private notify(): void {
        this.version += 1;
        for (const listener of this.listeners) {
            listener();
        }
    }

    private syncTicker(): void {
        if (this.view === "hidden") {
            this.stopTicker();
            return;
        }
        if (this.ticker !== null) {
            return;
        }
        const start = this.options.scope.setInterval;
        if (typeof start !== "function") {
            return;
        }
        this.ticker = start.call(this.options.scope, () => this.notify(), TICK_MS);
    }

    private stopTicker(): void {
        const stop = this.options.scope.clearInterval;
        if (this.ticker !== null && typeof stop === "function") {
            (stop as (handle: unknown) => void).call(this.options.scope, this.ticker);
        }
        this.ticker = null;
    }
}
