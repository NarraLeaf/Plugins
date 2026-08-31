/**
 * The profiler's memory: everything measured about one run, and nothing that knows how to measure
 * it.
 *
 * The split is deliberate. `probes.ts` owns the browser - the frame callback, the observers, the
 * wrappers around `fetch` and the object-URL factory - and does nothing but hand numbers to this
 * class. So every derivation here (percentiles, retention, the merge between two sources that both
 * saw the same request) is testable by calling methods, with no DOM and no timers.
 *
 * Everything is bounded. A profiler that runs for the length of a playthrough must not itself become
 * the memory problem it was installed to find, so the frame and heap histories are ring buffers, the
 * resource table and the marker list have caps, and whatever those caps drop is *counted* and shown
 * in the report. A silently truncated table reads as "this is everything", which is the one thing a
 * measurement must never claim falsely.
 */

/** How a loaded byte range is going to be used. Read off the address, since that is all we have. */
export type ResourceKind = "image" | "audio" | "video" | "font" | "script" | "style" | "document" | "other";

export const RESOURCE_KINDS: readonly ResourceKind[] = [
    "image",
    "audio",
    "video",
    "font",
    "script",
    "style",
    "document",
    "other",
];

const EXTENSION_KINDS: Record<string, ResourceKind> = {
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    webp: "image",
    avif: "image",
    bmp: "image",
    svg: "image",
    mp3: "audio",
    ogg: "audio",
    oga: "audio",
    wav: "audio",
    flac: "audio",
    m4a: "audio",
    aac: "audio",
    opus: "audio",
    mp4: "video",
    webm: "video",
    mov: "video",
    m4v: "video",
    woff: "font",
    woff2: "font",
    ttf: "font",
    otf: "font",
    eot: "font",
    js: "script",
    mjs: "script",
    cjs: "script",
    css: "style",
    html: "document",
    htm: "document",
};

const CONTENT_TYPE_KINDS: Array<[string, ResourceKind]> = [
    ["image/", "image"],
    ["audio/", "audio"],
    ["video/", "video"],
    ["font/", "font"],
    ["text/css", "style"],
    ["text/html", "document"],
    ["javascript", "script"],
];

/**
 * What kind of thing an address points at.
 *
 * The extension is the honest signal here and the content type is the better one when a probe
 * happened to read it, so the caller may pass one. Neither is available for an opaque address in a
 * protected build, and `other` is the correct answer there rather than a guess.
 */
export function classifyResource(url: string, contentType?: string | null): ResourceKind {
    if (contentType) {
        const lower = contentType.toLowerCase();
        for (const [needle, kind] of CONTENT_TYPE_KINDS) {
            if (lower.includes(needle)) {
                return kind;
            }
        }
    }
    const withoutQuery = url.split("?")[0].split("#")[0];
    const lastSegment = withoutQuery.split("/").pop() ?? "";
    const dot = lastSegment.lastIndexOf(".");
    if (dot > 0) {
        const extension = lastSegment.slice(dot + 1).toLowerCase();
        const kind = EXTENSION_KINDS[extension];
        if (kind) {
            return kind;
        }
    }
    return "other";
}

/** The tail of an address, for a table cell that has about forty characters to work with. */
export function resourceLabel(url: string): string {
    const withoutQuery = url.split("?")[0].split("#")[0];
    const segments = withoutQuery.split("/").filter(Boolean);
    if (segments.length === 0) {
        return url;
    }
    const tail = segments.slice(-2).join("/");
    let decoded = tail;
    try {
        decoded = decodeURIComponent(tail);
    } catch {
        // A half-encoded address is still a usable label; keep the raw one.
    }
    return decoded.length > 72 ? decoded.slice(0, 71) + "…" : decoded;
}

export type ResourceRecord = {
    url: string;
    label: string;
    kind: ResourceKind;
    /** Requests seen by the instrumented fetch/XHR wrappers. */
    probeRequests: number;
    /** Requests seen by the browser's own resource timing. */
    timingRequests: number;
    /**
     * How many times the run asked for this address.
     *
     * The larger of the two counts above, never their sum: an instrumented fetch also produces a
     * resource-timing entry, so adding them would double every asset the engine loads and the
     * "fetched twice" finding - the exact thing this table exists to surface - would be
     * indistinguishable from the instrumentation counting itself.
     */
    requests: number;
    /** Best known payload size for one request. */
    bytes: number;
    /** What the run actually moved for this address: {@link bytes} once per request. */
    totalBytes: number;
    firstAt: number;
    lastAt: number;
    totalMs: number;
    worstMs: number;
    decodeMs: number;
    decodes: number;
    failed: number;
    /** Object URLs still alive that were made from this address's bytes. */
    retainedBlobs: number;
    retainedBytes: number;
};

export type TimelineMarkerKind = "boot" | "engine" | "story" | "author" | "profiler";

export type TimelineMarker = {
    at: number;
    kind: TimelineMarkerKind;
    label: string;
    detail?: string;
};

export type SpanRecord = {
    name: string;
    startAt: number;
    endAt: number;
    durationMs: number;
};

export type HeapSample = {
    usedBytes: number;
    totalBytes: number;
    limitBytes: number;
};

export type FrameStats = {
    samples: number;
    /** Frames per second over the last two dozen frames - what a HUD should show. */
    fps: number;
    /** Frames per second over the whole retained window. */
    avgFps: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    worstMs: number;
    /** Frames that took longer than two 60Hz budgets. */
    hitches: number;
    /** Frames that took longer than a tenth of a second, which reads as a freeze. */
    stalls: number;
    /** The tail of the ring, oldest first, for the sparkline. */
    recentMs: number[];
};

export type ResourceTotals = {
    addresses: number;
    requests: number;
    bytes: number;
    /** Bytes that were re-requested: everything past the first request for each address. */
    repeatBytes: number;
    decodeMs: number;
    failed: number;
    byKind: Record<ResourceKind, { addresses: number; requests: number; bytes: number }>;
};

export type RetainedTotals = {
    blobs: number;
    bytes: number;
    byKind: Record<ResourceKind, { blobs: number; bytes: number }>;
};

export type CollectorCounters = {
    dialogueLines: number;
    choices: number;
    scenesEntered: number;
    savesWritten: number;
    restores: number;
};

export type CollectorSnapshot = {
    /** Wall-clock start of the measured session, so a report can say when it was taken. */
    startedAtEpochMs: number;
    elapsedMs: number;
    frames: FrameStats;
    longTasks: {
        supported: boolean;
        count: number;
        totalMs: number;
        worstMs: number;
        /** Time past the 50ms a long task is allowed before it counts as blocking. */
        blockingMs: number;
    };
    heap: {
        supported: boolean;
        usedBytes: number;
        totalBytes: number;
        limitBytes: number;
        peakBytes: number;
        recentUsedBytes: number[];
    };
    resources: {
        instrumented: boolean;
        records: ResourceRecord[];
        totals: ResourceTotals;
        /** Addresses the cap refused to track, and the requests they would have contributed. */
        droppedAddresses: number;
        droppedRequests: number;
    };
    retained: RetainedTotals;
    markers: TimelineMarker[];
    droppedMarkers: number;
    spans: SpanRecord[];
    openSpans: string[];
    counters: CollectorCounters;
    /** The profiler's own cost: time spent inside its frame callback. */
    overhead: { frames: number; totalMs: number; averageMs: number };
};

/**
 * The cheap reading: everything the heads-up display shows, with nothing sorted and nothing walked.
 *
 * Kept apart from {@link CollectorSnapshot} because the two are asked for at very different rates -
 * this one four times a second for as long as the overlay is up, that one when someone opens a page
 * or captures a report.
 */
export type QuickStats = {
    elapsedMs: number;
    /** Frames per second over the last two dozen frames. */
    fps: number;
    /** The mean of those same frames, in milliseconds. */
    frameMs: number;
    hitches: number;
    stalls: number;
    heapSupported: boolean;
    heapUsedBytes: number;
    retainedBlobs: number;
    retainedBytes: number;
    addresses: number;
    requests: number;
    bytes: number;
};

export type CollectorOptions = {
    historySeconds: number;
    /** Epoch milliseconds at which this session started. Injected so reports are reproducible. */
    startedAtEpochMs: number;
    /**
     * The monotonic clock, in the same domain as the frame callback's timestamp and a resource
     * timing entry's `startTime`.
     *
     * Injected rather than reached for so that every relative time in a report comes from one clock
     * - and so a test can drive a whole session without waiting for one. It is also why "how far
     * into the session are we" does not depend on frames still arriving: a game that has frozen is
     * exactly when the answer matters most.
     */
    now: () => number;
    maxAddresses?: number;
    maxMarkers?: number;
    maxSpans?: number;
};

const DEFAULT_MAX_ADDRESSES = 3000;
const DEFAULT_MAX_MARKERS = 600;
const DEFAULT_MAX_SPANS = 400;

/** Two 60Hz budgets. A frame past this is visible as a stutter rather than as a lower average. */
const HITCH_MS = 33.34;
const STALL_MS = 100;
const RECENT_FRAME_WINDOW = 24;
const SPARKLINE_FRAMES = 120;

function emptyByKind<T>(make: () => T): Record<ResourceKind, T> {
    const out = {} as Record<ResourceKind, T>;
    for (const kind of RESOURCE_KINDS) {
        out[kind] = make();
    }
    return out;
}

/** A fixed-size ring of numbers. Written to on every frame, so it allocates nothing per sample. */
class NumberRing {
    private readonly values: Float64Array;
    private cursor = 0;
    private filled = 0;

    public constructor(capacity: number) {
        this.values = new Float64Array(Math.max(1, capacity));
    }

    public push(value: number): void {
        this.values[this.cursor] = value;
        this.cursor = (this.cursor + 1) % this.values.length;
        if (this.filled < this.values.length) {
            this.filled += 1;
        }
    }

    public get size(): number {
        return this.filled;
    }

    /** Oldest first. */
    public toArray(limit = Number.POSITIVE_INFINITY): number[] {
        const take = Math.min(this.filled, limit);
        const out: number[] = new Array(take);
        const start = (this.cursor - take + this.values.length * 2) % this.values.length;
        for (let index = 0; index < take; index += 1) {
            out[index] = this.values[(start + index) % this.values.length];
        }
        return out;
    }

    public clear(): void {
        this.cursor = 0;
        this.filled = 0;
    }
}

function percentile(sorted: number[], fraction: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[index];
}

function round(value: number, digits = 2): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

export class PerformanceCollector {
    private readonly options: Required<CollectorOptions>;
    private readonly frameRing: NumberRing;
    private readonly heapRing: NumberRing;

    private startedAtEpochMs: number;
    private originNow: number;
    private lastFrameAt: number | null = null;

    private hitches = 0;
    private stalls = 0;
    private worstFrameMs = 0;

    private longTaskSupported = false;
    private longTasks = 0;
    private longTaskTotalMs = 0;
    private longTaskWorstMs = 0;
    private longTaskBlockingMs = 0;

    private heapSupported = false;
    private heapUsed = 0;
    private heapTotal = 0;
    private heapLimit = 0;
    private heapPeak = 0;

    private instrumented = false;
    private readonly resources = new Map<string, ResourceRecord>();
    /**
     * Running totals, kept in step with the records rather than recomputed.
     *
     * The heads-up display asks for these several times a second while the game is running, and
     * walking a table of a few thousand addresses at that rate would make the profiler part of what
     * it is measuring.
     */
    private runningRequests = 0;
    private runningBytes = 0;
    private runningRetainedBlobs = 0;
    private runningRetainedBytes = 0;
    private droppedAddresses = 0;
    private droppedRequests = 0;
    private readonly droppedAddressNames = new Set<string>();

    private readonly liveObjectUrls = new Map<string, { sourceUrl: string; bytes: number; kind: ResourceKind }>();

    private markers: TimelineMarker[] = [];
    private droppedMarkers = 0;
    private readonly openSpans = new Map<string, number>();
    private spans: SpanRecord[] = [];

    private counters: CollectorCounters = {
        dialogueLines: 0,
        choices: 0,
        scenesEntered: 0,
        savesWritten: 0,
        restores: 0,
    };

    private overheadFrames = 0;
    private overheadTotalMs = 0;

    public constructor(options: CollectorOptions) {
        this.options = {
            maxAddresses: DEFAULT_MAX_ADDRESSES,
            maxMarkers: DEFAULT_MAX_MARKERS,
            maxSpans: DEFAULT_MAX_SPANS,
            ...options,
        };
        // 144 samples a second covers a high-refresh display without truncating its history.
        this.frameRing = new NumberRing(Math.min(43200, Math.max(120, Math.round(options.historySeconds * 144))));
        this.heapRing = new NumberRing(Math.max(30, Math.round(options.historySeconds)));
        this.startedAtEpochMs = options.startedAtEpochMs;
        this.originNow = options.now();
    }

    /** Milliseconds since this session began. */
    public get elapsed(): number {
        return Math.max(0, this.options.now() - this.originNow);
    }

    /** A monotonic timestamp turned into an offset from the start of this session. */
    private relative(at: number | undefined): number {
        return typeof at === "number" && Number.isFinite(at)
            ? Math.max(0, at - this.originNow)
            : this.elapsed;
    }

    /** Declared by the probes, so the asset pages can say why they are empty rather than just being. */
    public setInstrumented(instrumented: boolean): void {
        this.instrumented = instrumented;
    }

    public setLongTasksSupported(supported: boolean): void {
        this.longTaskSupported = supported;
    }

    /**
     * One frame boundary, at the timestamp the frame callback was handed.
     *
     * The first call only sets the origin: there is no previous frame to measure against, and
     * inventing a duration for it would put one made-up sample at the front of every session.
     */
    public frame(timestamp: number): void {
        if (!Number.isFinite(timestamp)) {
            return;
        }
        if (this.lastFrameAt === null) {
            this.lastFrameAt = timestamp;
            return;
        }
        const delta = timestamp - this.lastFrameAt;
        this.lastFrameAt = timestamp;
        if (delta <= 0 || delta > 60000) {
            // A backgrounded window stops the frame callback entirely; the gap on return is not a
            // frame anyone saw and would otherwise become the worst frame of every session.
            return;
        }
        this.frameRing.push(delta);
        if (delta > this.worstFrameMs) {
            this.worstFrameMs = delta;
        }
        if (delta > STALL_MS) {
            this.stalls += 1;
        } else if (delta > HITCH_MS) {
            this.hitches += 1;
        }
    }

    /** Time the profiler itself spent in the frame callback, so the report can own its cost. */
    public overhead(ms: number): void {
        if (!Number.isFinite(ms) || ms < 0) {
            return;
        }
        this.overheadFrames += 1;
        this.overheadTotalMs += ms;
    }

    public longTask(durationMs: number): void {
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return;
        }
        this.longTaskSupported = true;
        this.longTasks += 1;
        this.longTaskTotalMs += durationMs;
        this.longTaskBlockingMs += Math.max(0, durationMs - 50);
        if (durationMs > this.longTaskWorstMs) {
            this.longTaskWorstMs = durationMs;
        }
    }

    public heap(sample: HeapSample): void {
        if (!Number.isFinite(sample.usedBytes)) {
            return;
        }
        this.heapSupported = true;
        this.heapUsed = sample.usedBytes;
        this.heapTotal = sample.totalBytes;
        this.heapLimit = sample.limitBytes;
        if (sample.usedBytes > this.heapPeak) {
            this.heapPeak = sample.usedBytes;
        }
        this.heapRing.push(sample.usedBytes);
    }

    private recordFor(url: string, kind: ResourceKind, at: number): ResourceRecord | null {
        const existing = this.resources.get(url);
        if (existing) {
            if (existing.kind === "other" && kind !== "other") {
                existing.kind = kind;
            }
            existing.lastAt = at;
            return existing;
        }
        if (this.resources.size >= this.options.maxAddresses) {
            if (!this.droppedAddressNames.has(url)) {
                this.droppedAddressNames.add(url);
                this.droppedAddresses += 1;
            }
            this.droppedRequests += 1;
            return null;
        }
        const created: ResourceRecord = {
            url,
            label: resourceLabel(url),
            kind,
            probeRequests: 0,
            timingRequests: 0,
            requests: 0,
            bytes: 0,
            totalBytes: 0,
            firstAt: at,
            lastAt: at,
            totalMs: 0,
            worstMs: 0,
            decodeMs: 0,
            decodes: 0,
            failed: 0,
            retainedBlobs: 0,
            retainedBytes: 0,
        };
        this.resources.set(url, created);
        return created;
    }

    private settle(record: ResourceRecord): void {
        this.runningRequests -= record.requests;
        this.runningBytes -= record.totalBytes;
        record.requests = Math.max(record.probeRequests, record.timingRequests);
        record.totalBytes = record.bytes * record.requests;
        this.runningRequests += record.requests;
        this.runningBytes += record.totalBytes;
    }

    /**
     * A request one of the wrappers watched from start to finish.
     *
     * `bytes` is what the body actually turned out to be, and is often only known later - a fetch
     * resolves long before anyone reads its body - so it arrives as `undefined` here and is filled
     * in by {@link resourceBytes} when the body is read.
     */
    public request(input: {
        url: string;
        /** Monotonic timestamp; omitted means "now". */
        at?: number;
        durationMs: number;
        bytes?: number;
        contentType?: string | null;
        failed?: boolean;
    }): void {
        const record = this.recordFor(
            input.url,
            classifyResource(input.url, input.contentType),
            this.relative(input.at),
        );
        if (!record) {
            return;
        }
        record.probeRequests += 1;
        if (Number.isFinite(input.durationMs) && input.durationMs >= 0) {
            record.totalMs += input.durationMs;
            if (input.durationMs > record.worstMs) {
                record.worstMs = input.durationMs;
            }
        }
        if (typeof input.bytes === "number" && Number.isFinite(input.bytes) && input.bytes > record.bytes) {
            record.bytes = input.bytes;
        }
        if (input.failed) {
            record.failed += 1;
        }
        this.settle(record);
    }

    /** The size of a body once something read it. Never counted as a request of its own. */
    public resourceBytes(url: string, bytes: number, contentType?: string | null): void {
        if (!Number.isFinite(bytes) || bytes <= 0) {
            return;
        }
        const record = this.resources.get(url);
        if (!record) {
            return;
        }
        if (contentType && record.kind === "other") {
            record.kind = classifyResource(url, contentType);
        }
        if (bytes > record.bytes) {
            record.bytes = bytes;
            this.settle(record);
        }
    }

    /**
     * An entry from the browser's own resource timing.
     *
     * Kept apart from {@link request} rather than folded into it because the two sources see the
     * same request from different sides: this one covers what no wrapper can (an image element's
     * `src`, a font, the document itself) but reports zero bytes whenever the response is
     * cross-origin without a timing-allow header, which on a custom protocol is always.
     */
    public timing(input: {
        url: string;
        /** Monotonic timestamp; omitted means "now". */
        at?: number;
        durationMs: number;
        bytes: number;
        initiatorKind?: ResourceKind;
    }): void {
        const record = this.recordFor(
            input.url,
            input.initiatorKind && input.initiatorKind !== "other"
                ? input.initiatorKind
                : classifyResource(input.url),
            this.relative(input.at),
        );
        if (!record) {
            return;
        }
        record.timingRequests += 1;
        if (record.probeRequests === 0 && Number.isFinite(input.durationMs) && input.durationMs >= 0) {
            // Only trust these timings for requests no wrapper measured: for the rest the wrapper
            // already added a duration for this very request, and adding a second would double it.
            record.totalMs += input.durationMs;
            if (input.durationMs > record.worstMs) {
                record.worstMs = input.durationMs;
            }
        }
        if (Number.isFinite(input.bytes) && input.bytes > record.bytes) {
            record.bytes = input.bytes;
        }
        this.settle(record);
    }

    public decode(url: string, durationMs: number): void {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
            return;
        }
        const source = this.sourceOfObjectUrl(url);
        const record = this.resources.get(url) ?? (source ? this.resources.get(source) : undefined);
        if (!record) {
            return;
        }
        record.decodes += 1;
        record.decodeMs += durationMs;
    }

    /** The address an object URL was made from, when one of ours made it. */
    public sourceOfObjectUrl(objectUrl: string): string | null {
        return this.liveObjectUrls.get(objectUrl)?.sourceUrl || null;
    }

    /**
     * An object URL was created from bytes that came from `sourceUrl`.
     *
     * This is the whole of "still in memory". The engine keeps a decoded image alive by keeping its
     * object URL alive, so a URL that was created and never revoked is a payload the process is
     * still holding - and the count of them, by kind, is the number an author is looking for when
     * the question is "what is my game keeping".
     */
    public retain(objectUrl: string, sourceUrl: string | null, bytes: number): void {
        const kind = sourceUrl ? classifyResource(sourceUrl) : "other";
        const size = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
        this.liveObjectUrls.set(objectUrl, { sourceUrl: sourceUrl ?? "", bytes: size, kind });
        this.runningRetainedBlobs += 1;
        this.runningRetainedBytes += size;
        if (!sourceUrl) {
            return;
        }
        const record = this.resources.get(sourceUrl);
        if (record) {
            record.retainedBlobs += 1;
            record.retainedBytes += size;
        }
    }

    public release(objectUrl: string): void {
        const entry = this.liveObjectUrls.get(objectUrl);
        if (!entry) {
            return;
        }
        this.liveObjectUrls.delete(objectUrl);
        this.runningRetainedBlobs = Math.max(0, this.runningRetainedBlobs - 1);
        this.runningRetainedBytes = Math.max(0, this.runningRetainedBytes - entry.bytes);
        const record = entry.sourceUrl ? this.resources.get(entry.sourceUrl) : undefined;
        if (record) {
            record.retainedBlobs = Math.max(0, record.retainedBlobs - 1);
            record.retainedBytes = Math.max(0, record.retainedBytes - entry.bytes);
        }
    }

    public mark(kind: TimelineMarkerKind, label: string, detail?: string): void {
        const marker: TimelineMarker = { at: round(this.elapsed), kind, label };
        if (detail) {
            marker.detail = detail;
        }
        this.markers.push(marker);
        if (this.markers.length > this.options.maxMarkers) {
            // Drop from the front: the interesting end of a long run is the recent end, and the
            // startup markers a session opened with are already in the report's timings section.
            this.markers = this.markers.slice(this.markers.length - this.options.maxMarkers);
            this.droppedMarkers += 1;
        }
    }

    public beginSpan(name: string): void {
        if (!name) {
            return;
        }
        this.openSpans.set(name, this.elapsed);
        this.mark("author", "begin " + name);
    }

    /** Ends a span and returns its duration, or null when nothing opened it. */
    public endSpan(name: string): number | null {
        if (!name || !this.openSpans.has(name)) {
            return null;
        }
        const startAt = this.openSpans.get(name) as number;
        this.openSpans.delete(name);
        const now = this.elapsed;
        const durationMs = Math.max(0, now - startAt);
        this.spans.push({
            name,
            startAt: round(startAt),
            endAt: round(now),
            durationMs: round(durationMs),
        });
        if (this.spans.length > this.options.maxSpans) {
            this.spans = this.spans.slice(this.spans.length - this.options.maxSpans);
        }
        this.mark("author", "end " + name, round(durationMs) + "ms");
        return durationMs;
    }

    public count(counter: keyof CollectorCounters, by = 1): void {
        this.counters[counter] += by;
    }

    /**
     * Start over, keeping the wiring.
     *
     * The probes stay installed and the object URLs the process is still holding stay tracked -
     * dropping those would report a game that had loaded nothing while it was holding 200MB. What is
     * cleared is everything that describes a window of time.
     */
    public reset(startedAtEpochMs: number): void {
        this.startedAtEpochMs = startedAtEpochMs;
        this.originNow = this.options.now();
        this.frameRing.clear();
        this.heapRing.clear();
        this.lastFrameAt = null;
        this.hitches = 0;
        this.stalls = 0;
        this.worstFrameMs = 0;
        this.longTasks = 0;
        this.longTaskTotalMs = 0;
        this.longTaskWorstMs = 0;
        this.longTaskBlockingMs = 0;
        this.heapPeak = this.heapUsed;
        this.resources.clear();
        this.runningRequests = 0;
        this.runningBytes = 0;
        this.droppedAddresses = 0;
        this.droppedRequests = 0;
        this.droppedAddressNames.clear();
        this.markers = [];
        this.droppedMarkers = 0;
        this.openSpans.clear();
        this.spans = [];
        this.counters = {
            dialogueLines: 0,
            choices: 0,
            scenesEntered: 0,
            savesWritten: 0,
            restores: 0,
        };
        this.overheadFrames = 0;
        this.overheadTotalMs = 0;
        this.mark("profiler", "session reset");
    }

    /** See {@link QuickStats}. Touches only the tail of the frame ring and the running totals. */
    public quick(): QuickStats {
        const recent = this.frameRing.toArray(RECENT_FRAME_WINDOW);
        const total = recent.reduce((sum, value) => sum + value, 0);
        return {
            elapsedMs: round(this.elapsed),
            fps: total > 0 ? round((recent.length * 1000) / total, 1) : 0,
            frameMs: recent.length > 0 ? round(total / recent.length) : 0,
            hitches: this.hitches,
            stalls: this.stalls,
            heapSupported: this.heapSupported,
            heapUsedBytes: this.heapUsed,
            retainedBlobs: this.runningRetainedBlobs,
            retainedBytes: this.runningRetainedBytes,
            addresses: this.resources.size,
            requests: this.runningRequests,
            bytes: this.runningBytes,
        };
    }

    private frameStats(): FrameStats {
        const all = this.frameRing.toArray();
        if (all.length === 0) {
            return {
                samples: 0,
                fps: 0,
                avgFps: 0,
                p50Ms: 0,
                p95Ms: 0,
                p99Ms: 0,
                worstMs: 0,
                hitches: this.hitches,
                stalls: this.stalls,
                recentMs: [],
            };
        }
        const sorted = [...all].sort((left, right) => left - right);
        const total = all.reduce((sum, value) => sum + value, 0);
        const recentSlice = all.slice(Math.max(0, all.length - RECENT_FRAME_WINDOW));
        const recentTotal = recentSlice.reduce((sum, value) => sum + value, 0);
        return {
            samples: all.length,
            fps: recentTotal > 0 ? round((recentSlice.length * 1000) / recentTotal, 1) : 0,
            avgFps: total > 0 ? round((all.length * 1000) / total, 1) : 0,
            p50Ms: round(percentile(sorted, 0.5)),
            p95Ms: round(percentile(sorted, 0.95)),
            p99Ms: round(percentile(sorted, 0.99)),
            worstMs: round(this.worstFrameMs),
            hitches: this.hitches,
            stalls: this.stalls,
            recentMs: all.slice(Math.max(0, all.length - SPARKLINE_FRAMES)).map(value => round(value, 1)),
        };
    }

    private resourceTotals(records: ResourceRecord[]): ResourceTotals {
        const byKind = emptyByKind(() => ({ addresses: 0, requests: 0, bytes: 0 }));
        let requests = 0;
        let bytes = 0;
        let repeatBytes = 0;
        let decodeMs = 0;
        let failed = 0;
        for (const record of records) {
            requests += record.requests;
            bytes += record.totalBytes;
            repeatBytes += Math.max(0, record.requests - 1) * record.bytes;
            decodeMs += record.decodeMs;
            failed += record.failed;
            const bucket = byKind[record.kind];
            bucket.addresses += 1;
            bucket.requests += record.requests;
            bucket.bytes += record.totalBytes;
        }
        return {
            addresses: records.length,
            requests,
            bytes,
            repeatBytes,
            decodeMs: round(decodeMs),
            failed,
            byKind,
        };
    }

    private retainedTotals(): RetainedTotals {
        const byKind = emptyByKind(() => ({ blobs: 0, bytes: 0 }));
        let blobs = 0;
        let bytes = 0;
        for (const entry of this.liveObjectUrls.values()) {
            blobs += 1;
            bytes += entry.bytes;
            const bucket = byKind[entry.kind];
            bucket.blobs += 1;
            bucket.bytes += entry.bytes;
        }
        return { blobs, bytes, byKind };
    }

    public snapshot(): CollectorSnapshot {
        const records = [...this.resources.values()].map(record => ({ ...record }));
        return {
            startedAtEpochMs: this.startedAtEpochMs,
            elapsedMs: round(this.elapsed),
            frames: this.frameStats(),
            longTasks: {
                supported: this.longTaskSupported,
                count: this.longTasks,
                totalMs: round(this.longTaskTotalMs),
                worstMs: round(this.longTaskWorstMs),
                blockingMs: round(this.longTaskBlockingMs),
            },
            heap: {
                supported: this.heapSupported,
                usedBytes: this.heapUsed,
                totalBytes: this.heapTotal,
                limitBytes: this.heapLimit,
                peakBytes: this.heapPeak,
                recentUsedBytes: this.heapRing.toArray(),
            },
            resources: {
                instrumented: this.instrumented,
                records,
                totals: this.resourceTotals(records),
                droppedAddresses: this.droppedAddresses,
                droppedRequests: this.droppedRequests,
            },
            retained: this.retainedTotals(),
            markers: [...this.markers],
            droppedMarkers: this.droppedMarkers,
            spans: [...this.spans],
            openSpans: [...this.openSpans.keys()],
            counters: { ...this.counters },
            overhead: {
                frames: this.overheadFrames,
                totalMs: round(this.overheadTotalMs),
                averageMs: this.overheadFrames > 0 ? round(this.overheadTotalMs / this.overheadFrames, 4) : 0,
            },
        };
    }
}
