/**
 * Turning a snapshot into something someone can act on: a machine-readable report, and the same
 * thing written out.
 *
 * Both are produced from one snapshot at one instant, so the summary can never disagree with the
 * JSON beside it. Both are pure functions of that snapshot - no clock, no globals - which is what
 * makes them testable and what makes two captures of the same session byte-identical.
 *
 * The written form is not a debug dump. It is ordered the way the question is usually asked: is it
 * smooth, is it holding too much, what did it load, and what happened while it ran.
 */

import type {
    CollectorSnapshot,
    ResourceKind,
    ResourceRecord,
} from "./collector";
import { RESOURCE_KINDS } from "./collector";

export const REPORT_FORMAT = "narraleaf.performance-inspector/report";
export const REPORT_VERSION = 1;

/** What the machine looked like. Every field optional: none of it is available everywhere. */
export type EnvironmentInfo = {
    userAgent?: string;
    platform?: string;
    /** Logical cores, which is what a decode pool is sized against. */
    hardwareConcurrency?: number;
    /** Gigabytes, coarsely rounded by the browser itself. */
    deviceMemoryGb?: number;
    screen?: { width: number; height: number };
    viewport?: { width: number; height: number };
    devicePixelRatio?: number;
    language?: string;
    /**
     * The address scheme the page was served from, which is the only thing that separates a shell
     * from a shell here: a packaged game and a preview both answer `nlgame:`, a Dev Mode window
     * answers whatever Studio serves itself over, and a web export answers `http:` or `file:`.
     */
    shell?: string;
};

export type ReportedResource = {
    url: string;
    kind: ResourceKind;
    requests: number;
    bytes: number;
    totalBytes: number;
    firstAtMs: number;
    lastAtMs: number;
    totalMs: number;
    worstMs: number;
    decodeMs: number;
    decodes: number;
    failed: number;
    retainedBlobs: number;
    retainedBytes: number;
};

export type PerformanceReport = {
    format: typeof REPORT_FORMAT;
    version: typeof REPORT_VERSION;
    pluginVersion: string;
    capturedAtEpochMs: number;
    session: {
        startedAtEpochMs: number;
        elapsedMs: number;
    };
    environment: EnvironmentInfo;
    locale?: string;
    frames: CollectorSnapshot["frames"];
    longTasks: CollectorSnapshot["longTasks"];
    heap: Omit<CollectorSnapshot["heap"], "recentUsedBytes">;
    resources: {
        instrumented: boolean;
        addresses: number;
        requests: number;
        bytes: number;
        repeatBytes: number;
        decodeMs: number;
        failed: number;
        byKind: CollectorSnapshot["resources"]["totals"]["byKind"];
        droppedAddresses: number;
        droppedRequests: number;
        /** Every address the run touched, heaviest first. */
        entries: ReportedResource[];
    };
    retained: CollectorSnapshot["retained"];
    timeline: CollectorSnapshot["markers"];
    droppedMarkers: number;
    /** Which scene each timeline number refers to. See `SceneRecord`. */
    scenes: CollectorSnapshot["scenes"];
    spans: CollectorSnapshot["spans"];
    openSpans: string[];
    counters: CollectorSnapshot["counters"];
    overhead: CollectorSnapshot["overhead"];
    /** Things a reader has to know before trusting a number above. */
    notes: string[];
};

export type BuildReportInput = {
    snapshot: CollectorSnapshot;
    environment: EnvironmentInfo;
    pluginVersion: string;
    capturedAtEpochMs: number;
    locale?: string;
};

function reportResource(record: ResourceRecord): ReportedResource {
    return {
        url: record.url,
        kind: record.kind,
        requests: record.requests,
        bytes: record.bytes,
        totalBytes: record.totalBytes,
        firstAtMs: Math.round(record.firstAt),
        lastAtMs: Math.round(record.lastAt),
        totalMs: Math.round(record.totalMs),
        worstMs: Math.round(record.worstMs),
        decodeMs: Math.round(record.decodeMs),
        decodes: record.decodes,
        failed: record.failed,
        retainedBlobs: record.retainedBlobs,
        retainedBytes: record.retainedBytes,
    };
}

/**
 * The caveats, computed rather than remembered.
 *
 * A report that omits these is a report that overstates itself: an uninstrumented run genuinely
 * cannot see byte counts, and a capped table genuinely is not the whole list. Both belong next to
 * the numbers they qualify, not in documentation nobody has open.
 */
function buildNotes(snapshot: CollectorSnapshot): string[] {
    const notes: string[] = [];
    if (!snapshot.resources.instrumented) {
        notes.push(
            "Asset instrumentation was off, so sizes and retention come only from resource timing - "
            + "which reports zero bytes for this shell's assets. Turn it on in the Performance panel "
            + "for byte counts and in-memory figures.",
        );
    }
    if (!snapshot.heap.supported) {
        notes.push("This engine does not expose JavaScript heap counters, so heap figures are absent.");
    }
    if (!snapshot.longTasks.supported) {
        notes.push("This engine does not report long tasks, so the main-thread blocking figure is absent.");
    }
    if (snapshot.resources.droppedAddresses > 0) {
        notes.push(
            `The address table hit its cap: ${snapshot.resources.droppedAddresses} further addresses `
            + `(${snapshot.resources.droppedRequests} requests) were seen but not recorded. Totals below `
            + "exclude them.",
        );
    }
    if (snapshot.droppedMarkers > 0) {
        notes.push(
            `The timeline kept only its most recent ${snapshot.markers.length} entries; earlier ones were dropped.`,
        );
    }
    if (snapshot.openSpans.length > 0) {
        notes.push(`Spans still open at capture, so absent from the span list: ${snapshot.openSpans.join(", ")}.`);
    }
    if (snapshot.frames.samples === 0) {
        notes.push("No frames were sampled. Either the window was never painted or the frame probe could not install.");
    }
    return notes;
}

export function buildReport(input: BuildReportInput): PerformanceReport {
    const { snapshot } = input;
    const entries = snapshot.resources.records
        .map(reportResource)
        .sort((left, right) => right.totalBytes - left.totalBytes || right.requests - left.requests);

    const report: PerformanceReport = {
        format: REPORT_FORMAT,
        version: REPORT_VERSION,
        pluginVersion: input.pluginVersion,
        capturedAtEpochMs: input.capturedAtEpochMs,
        session: {
            startedAtEpochMs: snapshot.startedAtEpochMs,
            elapsedMs: snapshot.elapsedMs,
        },
        environment: input.environment,
        frames: snapshot.frames,
        longTasks: snapshot.longTasks,
        heap: {
            supported: snapshot.heap.supported,
            usedBytes: snapshot.heap.usedBytes,
            totalBytes: snapshot.heap.totalBytes,
            limitBytes: snapshot.heap.limitBytes,
            peakBytes: snapshot.heap.peakBytes,
        },
        resources: {
            instrumented: snapshot.resources.instrumented,
            addresses: snapshot.resources.totals.addresses,
            requests: snapshot.resources.totals.requests,
            bytes: snapshot.resources.totals.bytes,
            repeatBytes: snapshot.resources.totals.repeatBytes,
            decodeMs: snapshot.resources.totals.decodeMs,
            failed: snapshot.resources.totals.failed,
            byKind: snapshot.resources.totals.byKind,
            droppedAddresses: snapshot.resources.droppedAddresses,
            droppedRequests: snapshot.resources.droppedRequests,
            entries,
        },
        retained: snapshot.retained,
        timeline: snapshot.markers,
        droppedMarkers: snapshot.droppedMarkers,
        scenes: snapshot.scenes,
        spans: snapshot.spans,
        openSpans: snapshot.openSpans,
        counters: snapshot.counters,
        overhead: snapshot.overhead,
        notes: buildNotes(snapshot),
    };
    if (input.locale) {
        report.locale = input.locale;
    }
    return report;
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return "0 B";
    }
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function formatMs(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) {
        return "0ms";
    }
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    if (ms < 60000) {
        return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
    }
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
}

function padEnd(text: string, width: number): string {
    return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function padStart(text: string, width: number): string {
    return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

function isoOrUnknown(epochMs: number): string {
    if (!Number.isFinite(epochMs) || epochMs <= 0) {
        return "unknown";
    }
    return new Date(epochMs).toISOString();
}

const TOP_RESOURCES_IN_SUMMARY = 25;

/**
 * The written report.
 *
 * Sections in the order the questions get asked, each one leading with the number that decides
 * whether to read the rest. Line-oriented and free of box drawing on purpose: it goes into a log
 * file, a bug report and a chat message, and it has to survive all three.
 */
export function formatReportText(report: PerformanceReport): string {
    const lines: string[] = [];
    const push = (line = ""): void => {
        lines.push(line);
    };

    push("NarraLeaf Performance Inspector");
    push(`captured ${isoOrUnknown(report.capturedAtEpochMs)} - plugin ${report.pluginVersion}`);
    push(`session started ${isoOrUnknown(report.session.startedAtEpochMs)}, ran ${formatMs(report.session.elapsedMs)}`);
    if (report.environment.shell) {
        push(`shell ${report.environment.shell}`);
    }
    if (report.locale) {
        push(`game language ${report.locale}`);
    }

    push();
    push("FRAMES");
    const frames = report.frames;
    if (frames.samples === 0) {
        push("  no frames sampled");
    } else {
        push(`  ${frames.avgFps} fps average over ${frames.samples} frames (${frames.fps} fps at capture)`);
        push(`  frame time  p50 ${frames.p50Ms}ms  p95 ${frames.p95Ms}ms  p99 ${frames.p99Ms}ms  worst ${frames.worstMs}ms`);
        push(`  ${frames.hitches} hitches over 33ms, ${frames.stalls} stalls over 100ms`);
    }
    if (report.longTasks.supported) {
        push(
            `  ${report.longTasks.count} long tasks, ${formatMs(report.longTasks.blockingMs)} blocking, `
            + `worst ${Math.round(report.longTasks.worstMs)}ms`,
        );
    }

    push();
    push("MEMORY");
    if (report.heap.supported) {
        push(
            `  JS heap ${formatBytes(report.heap.usedBytes)} used of ${formatBytes(report.heap.totalBytes)} `
            + `allocated (peak ${formatBytes(report.heap.peakBytes)}, limit ${formatBytes(report.heap.limitBytes)})`,
        );
    } else {
        push("  JS heap counters unavailable on this engine");
    }
    push(
        `  held in memory: ${report.retained.blobs} object URLs, ${formatBytes(report.retained.bytes)}`,
    );
    for (const kind of RESOURCE_KINDS) {
        const bucket = report.retained.byKind[kind];
        if (bucket.blobs > 0) {
            push(`    ${padEnd(kind, 9)} ${padStart(String(bucket.blobs), 5)}  ${formatBytes(bucket.bytes)}`);
        }
    }

    push();
    push("ASSETS LOADED");
    push(
        `  ${report.resources.addresses} addresses, ${report.resources.requests} requests, `
        + `${formatBytes(report.resources.bytes)} transferred`,
    );
    if (report.resources.repeatBytes > 0) {
        push(`  ${formatBytes(report.resources.repeatBytes)} of that was addresses fetched more than once`);
    }
    if (report.resources.decodeMs > 0) {
        push(`  ${formatMs(report.resources.decodeMs)} spent decoding`);
    }
    if (report.resources.failed > 0) {
        push(`  ${report.resources.failed} requests failed`);
    }
    for (const kind of RESOURCE_KINDS) {
        const bucket = report.resources.byKind[kind];
        if (bucket.addresses > 0) {
            push(
                `    ${padEnd(kind, 9)} ${padStart(String(bucket.addresses), 5)} addresses  `
                + `${padStart(String(bucket.requests), 5)} requests  ${formatBytes(bucket.bytes)}`,
            );
        }
    }

    const top = report.resources.entries.slice(0, TOP_RESOURCES_IN_SUMMARY);
    if (top.length > 0) {
        push();
        push(`  heaviest ${top.length} of ${report.resources.entries.length}:`);
        push(`    ${padEnd("bytes", 10)}${padEnd("reqs", 6)}${padEnd("kind", 10)}${padEnd("held", 6)}address`);
        for (const entry of top) {
            push(
                "    "
                + padEnd(formatBytes(entry.totalBytes), 10)
                + padEnd(String(entry.requests), 6)
                + padEnd(entry.kind, 10)
                + padEnd(entry.retainedBlobs > 0 ? "yes" : "no", 6)
                + entry.url,
            );
        }
        if (report.resources.entries.length > top.length) {
            push(`    (${report.resources.entries.length - top.length} more in the JSON report)`);
        }
    }

    push();
    push("PLAYTHROUGH");
    push(
        `  ${report.counters.scenesEntered} scenes entered, ${report.counters.dialogueLines} lines shown, `
        + `${report.counters.choices} choices taken`,
    );
    push(`  ${report.counters.savesWritten} saves written, ${report.counters.restores} restores`);

    if (report.spans.length > 0) {
        push();
        push("SPANS");
        for (const span of report.spans) {
            push(`  ${padEnd(span.name, 28)} ${formatMs(span.durationMs)}  (at ${formatMs(span.startAt)})`);
        }
    }

    if (report.timeline.length > 0) {
        push();
        push("TIMELINE");
        for (const marker of report.timeline) {
            push(
                `  ${padStart(formatMs(marker.at), 9)}  ${padEnd(marker.kind, 9)} ${marker.label}`
                + (marker.detail ? `  ${marker.detail}` : ""),
            );
        }
    }

    push();
    push("ENVIRONMENT");
    const environment = report.environment;
    if (environment.platform) {
        push(`  platform ${environment.platform}`);
    }
    if (typeof environment.hardwareConcurrency === "number") {
        push(`  ${environment.hardwareConcurrency} logical cores`);
    }
    if (typeof environment.deviceMemoryGb === "number") {
        push(`  ${environment.deviceMemoryGb} GB device memory (as reported)`);
    }
    if (environment.screen) {
        push(`  screen ${environment.screen.width}x${environment.screen.height}`);
    }
    if (environment.viewport) {
        push(
            `  viewport ${environment.viewport.width}x${environment.viewport.height}`
            + (environment.devicePixelRatio ? ` at ${environment.devicePixelRatio}x` : ""),
        );
    }
    if (environment.userAgent) {
        push(`  ${environment.userAgent}`);
    }
    push(
        `  profiler overhead ${report.overhead.averageMs}ms per frame over ${report.overhead.frames} frames `
        + `(${formatMs(report.overhead.totalMs)} total)`,
    );

    if (report.notes.length > 0) {
        push();
        push("NOTES");
        for (const note of report.notes) {
            push(`  - ${note}`);
        }
    }

    push();
    return lines.join("\n");
}

/** The report as JSON, stably indented so two captures diff cleanly. */
export function formatReportJson(report: PerformanceReport): string {
    return JSON.stringify(report, null, 2);
}
