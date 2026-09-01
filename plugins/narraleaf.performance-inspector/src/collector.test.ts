import { describe, expect, it } from "vitest";
import { PerformanceCollector, classifyResource, resourceLabel } from "./collector";

/** A collector driven by a clock the test moves by hand, so no timing is left to the machine. */
function makeCollector(overrides: { historySeconds?: number; maxAddresses?: number; maxMarkers?: number } = {}) {
    let now = 1000;
    const collector = new PerformanceCollector({
        historySeconds: overrides.historySeconds ?? 60,
        startedAtEpochMs: 1_700_000_000_000,
        now: () => now,
        maxAddresses: overrides.maxAddresses,
        maxMarkers: overrides.maxMarkers,
    });
    return {
        collector,
        advance(ms: number) {
            now += ms;
        },
        get now() {
            return now;
        },
    };
}

/** Feeds `count` frames of `frameMs` each, starting from the collector's own origin. */
function feedFrames(collector: PerformanceCollector, durations: number[], startAt = 1000): void {
    let timestamp = startAt;
    collector.frame(timestamp);
    for (const duration of durations) {
        timestamp += duration;
        collector.frame(timestamp);
    }
}

describe("classifyResource", () => {
    it("reads the extension, ignoring the query and the fragment", () => {
        expect(classifyResource("nlgame://asset/bg/room.png?v=3")).toBe("image");
        expect(classifyResource("nlgame://asset/bgm/theme.ogg#loop")).toBe("audio");
        expect(classifyResource("https://example.test/font.woff2")).toBe("font");
    });

    it("prefers a content type when one was observed", () => {
        expect(classifyResource("nlgame://asset/4f2c9a", "image/webp")).toBe("image");
    });

    it("answers other for an address that names nothing, which is every protected asset", () => {
        expect(classifyResource("nlgame://asset/9f8c1b2d")).toBe("other");
    });
});

describe("resourceLabel", () => {
    it("keeps the last two segments and decodes them", () => {
        expect(resourceLabel("nlgame://asset/backgrounds/caf%C3%A9.png?v=2")).toBe("backgrounds/café.png");
    });
});

describe("frames", () => {
    it("does not invent a duration for the first frame", () => {
        const { collector } = makeCollector();
        collector.frame(1000);
        expect(collector.snapshot().frames.samples).toBe(0);
    });

    it("reports percentiles by nearest rank over the retained window", () => {
        const { collector } = makeCollector();
        // Ninety-eight frames at 10ms and two at 200ms: the worst two percent are the outliers, so
        // they are what p99 reports and the median is untouched by them.
        feedFrames(collector, [...Array(98).fill(10), 200, 200]);
        const frames = collector.snapshot().frames;
        expect(frames.samples).toBe(100);
        expect(frames.p50Ms).toBe(10);
        expect(frames.p99Ms).toBe(200);
        expect(frames.worstMs).toBe(200);
        expect(frames.stalls).toBe(2);
        expect(frames.hitches).toBe(0);
    });

    it("leaves a single outlier in a hundred frames to worstMs rather than to p99", () => {
        const { collector } = makeCollector();
        // Nearest rank: ninety-nine of a hundred frames are inside 10ms, so that is what p99 says.
        // The outlier is not lost - `worstMs` is the field that reports it.
        feedFrames(collector, [...Array(99).fill(10), 200]);
        const frames = collector.snapshot().frames;
        expect(frames.p99Ms).toBe(10);
        expect(frames.worstMs).toBe(200);
    });

    it("counts a frame over two 60Hz budgets as a hitch and one over 100ms as a stall", () => {
        const { collector } = makeCollector();
        feedFrames(collector, [16, 40, 120, 16]);
        const frames = collector.snapshot().frames;
        expect(frames.hitches).toBe(1);
        expect(frames.stalls).toBe(1);
    });

    it("throws away the gap a backgrounded window leaves behind", () => {
        const { collector } = makeCollector();
        // A minute and a half with no frame callback is not a frame anyone saw.
        feedFrames(collector, [16, 90_000, 16]);
        const frames = collector.snapshot().frames;
        expect(frames.samples).toBe(2);
        expect(frames.worstMs).toBe(16);
        expect(frames.stalls).toBe(0);
    });

    it("keeps only the retained window, oldest samples first out", () => {
        // 1 second of history is 144 samples; feeding 200 must leave the last 144.
        const { collector } = makeCollector({ historySeconds: 1 });
        feedFrames(collector, [...Array(200).fill(10)]);
        expect(collector.snapshot().frames.samples).toBe(144);
    });
});

describe("frameSeries", () => {
    it("covers a span of time rather than a count of frames", () => {
        const { collector } = makeCollector();
        // Twelve seconds of 60Hz frames; a ten-second window must not reach the first two.
        feedFrames(collector, [...Array(720).fill(16.7)]);
        const series = collector.frameSeries(10_000, 1000);
        // Sum of the returned durations is the span it covers.
        const covered = series.reduce((sum, value) => sum + value, 0);
        expect(covered).toBeGreaterThan(9_900);
        expect(covered).toBeLessThan(10_100);
    });

    it("takes as many frames as ten seconds happens to contain, whatever the refresh rate", () => {
        const sixty = makeCollector().collector;
        feedFrames(sixty, [...Array(900).fill(16.7)]);
        const hundredForty = makeCollector().collector;
        feedFrames(hundredForty, [...Array(2000).fill(6.94)]);

        // The point of windowing by time: both chart the same ten seconds, so the fast machine takes
        // more samples to do it rather than racing through four times as much of the run.
        expect(sixty.frameSeries(10_000, 5000)).toHaveLength(Math.ceil(10_000 / 16.7));
        expect(hundredForty.frameSeries(10_000, 5000)).toHaveLength(Math.ceil(10_000 / 6.94));
    });

    it("keeps a spike when it has to reduce the points", () => {
        const { collector } = makeCollector();
        feedFrames(collector, [...Array(300).fill(16), 250, ...Array(300).fill(16)]);
        const series = collector.frameSeries(10_000, 20);
        expect(series).toHaveLength(20);
        // Averaging would bury it; the maximum is the whole reason anyone opens the chart.
        expect(Math.max(...series)).toBe(250);
    });

    it("returns the samples themselves when there are fewer than the chart has room for", () => {
        const { collector } = makeCollector();
        feedFrames(collector, [16, 17, 18]);
        expect(collector.frameSeries(10_000, 240)).toEqual([16, 17, 18]);
    });

    it("is oldest first, so the chart scrolls to the left", () => {
        const { collector } = makeCollector();
        feedFrames(collector, [10, 20, 30]);
        expect(collector.frameSeries(10_000, 240)).toEqual([10, 20, 30]);
    });
});

describe("resource accounting", () => {
    it("takes the larger of the two request counts rather than their sum", () => {
        const { collector, advance } = makeCollector();
        advance(100);
        // The same fetch is seen twice: once by the wrapper, once by resource timing.
        collector.request({ url: "a.png", durationMs: 12, bytes: 2048 });
        collector.timing({ url: "a.png", durationMs: 12, bytes: 0 });
        const record = collector.snapshot().resources.records[0];
        expect(record.requests).toBe(1);
        expect(record.totalBytes).toBe(2048);
    });

    it("counts a genuine second fetch, and charges its bytes again", () => {
        const { collector } = makeCollector();
        collector.request({ url: "a.png", durationMs: 12, bytes: 2048 });
        collector.request({ url: "a.png", durationMs: 9, bytes: 2048 });
        const totals = collector.snapshot().resources.totals;
        expect(totals.requests).toBe(2);
        expect(totals.bytes).toBe(4096);
        expect(totals.repeatBytes).toBe(2048);
    });

    it("fills the size in when the body is finally read", () => {
        const { collector } = makeCollector();
        collector.request({ url: "a.png", durationMs: 12 });
        expect(collector.snapshot().resources.totals.bytes).toBe(0);
        collector.resourceBytes("a.png", 4096, "image/png");
        expect(collector.snapshot().resources.totals.bytes).toBe(4096);
    });

    it("does not add a duration twice for a request a wrapper already timed", () => {
        const { collector } = makeCollector();
        collector.request({ url: "a.png", durationMs: 30, bytes: 10 });
        collector.timing({ url: "a.png", durationMs: 30, bytes: 10 });
        expect(collector.snapshot().resources.records[0].totalMs).toBe(30);
    });

    it("times a load no wrapper saw", () => {
        const { collector } = makeCollector();
        collector.timing({ url: "font.woff2", durationMs: 42, bytes: 100 });
        const record = collector.snapshot().resources.records[0];
        expect(record.totalMs).toBe(42);
        expect(record.kind).toBe("font");
    });

    it("counts what the address cap refused rather than dropping it silently", () => {
        const { collector } = makeCollector({ maxAddresses: 2 });
        collector.request({ url: "a.png", durationMs: 1, bytes: 1 });
        collector.request({ url: "b.png", durationMs: 1, bytes: 1 });
        collector.request({ url: "c.png", durationMs: 1, bytes: 1 });
        collector.request({ url: "c.png", durationMs: 1, bytes: 1 });
        collector.request({ url: "d.png", durationMs: 1, bytes: 1 });
        const resources = collector.snapshot().resources;
        expect(resources.records).toHaveLength(2);
        expect(resources.droppedAddresses).toBe(2);
        expect(resources.droppedRequests).toBe(3);
    });
});

describe("retention", () => {
    it("attributes a live object URL to the address its bytes came from", () => {
        const { collector } = makeCollector();
        collector.request({ url: "room.png", durationMs: 5, bytes: 5000 });
        collector.retain("blob:1", "room.png", 5000);
        const snapshot = collector.snapshot();
        expect(snapshot.retained.blobs).toBe(1);
        expect(snapshot.retained.bytes).toBe(5000);
        expect(snapshot.retained.byKind.image.blobs).toBe(1);
        expect(snapshot.resources.records[0].retainedBlobs).toBe(1);
    });

    it("stops counting a revoked object URL", () => {
        const { collector } = makeCollector();
        collector.request({ url: "room.png", durationMs: 5, bytes: 5000 });
        collector.retain("blob:1", "room.png", 5000);
        collector.release("blob:1");
        const snapshot = collector.snapshot();
        expect(snapshot.retained.blobs).toBe(0);
        expect(snapshot.retained.bytes).toBe(0);
        expect(snapshot.resources.records[0].retainedBlobs).toBe(0);
        expect(snapshot.resources.records[0].retainedBytes).toBe(0);
    });

    it("charges a decode against the address behind the object URL", () => {
        const { collector } = makeCollector();
        collector.request({ url: "room.png", durationMs: 5, bytes: 5000 });
        collector.retain("blob:1", "room.png", 5000);
        collector.decode("blob:1", 120);
        expect(collector.snapshot().resources.records[0].decodeMs).toBe(120);
    });

    it("lets a decode name the kind of an address that named nothing", () => {
        const { collector } = makeCollector();
        // What a Dev Mode grant token and a protected build's derived id both look like: no
        // extension, and served as application/octet-stream.
        collector.request({ url: "app://fs/oJMY3xyBZdS", durationMs: 5, bytes: 5000 });
        expect(collector.snapshot().resources.records[0].kind).toBe("other");

        collector.retain("blob:1", "app://fs/oJMY3xyBZdS", 5000);
        collector.decode("blob:1", 40);
        const snapshot = collector.snapshot();
        expect(snapshot.resources.records[0].kind).toBe("image");
        // The retained breakdown is grouped by kind, so it has to learn it too.
        expect(snapshot.retained.byKind.image.bytes).toBe(5000);
        expect(snapshot.retained.byKind.other.bytes).toBe(0);
    });

    it("takes an audio decode as proof of an audio asset", () => {
        const { collector } = makeCollector();
        collector.request({ url: "app://fs/D2FYb1Z3Nd0", durationMs: 5, bytes: 700_000 });
        collector.decode("app://fs/D2FYb1Z3Nd0", 18, "audio");
        expect(collector.snapshot().resources.records[0].kind).toBe("audio");
    });

    it("does not let a decode overrule a kind the address already stated", () => {
        const { collector } = makeCollector();
        collector.request({ url: "theme.ogg", durationMs: 5, bytes: 700 });
        collector.decode("theme.ogg", 18);
        expect(collector.snapshot().resources.records[0].kind).toBe("audio");
    });
});

describe("marks and spans", () => {
    it("measures a span against the injected clock", () => {
        const { collector, advance } = makeCollector();
        advance(500);
        collector.beginSpan("chapter 2");
        advance(1500);
        expect(collector.endSpan("chapter 2")).toBe(1500);
        const span = collector.snapshot().spans[0];
        expect(span.startAt).toBe(500);
        expect(span.durationMs).toBe(1500);
    });

    it("answers null for a span nothing opened", () => {
        const { collector } = makeCollector();
        expect(collector.endSpan("never begun")).toBeNull();
    });

    it("names spans still open at snapshot time", () => {
        const { collector } = makeCollector();
        collector.beginSpan("prologue");
        expect(collector.snapshot().openSpans).toEqual(["prologue"]);
    });

    it("keeps the recent end of an overlong timeline and says it dropped the rest", () => {
        const { collector } = makeCollector({ maxMarkers: 3 });
        for (let index = 0; index < 6; index += 1) {
            collector.mark("author", `mark ${index}`);
        }
        const snapshot = collector.snapshot();
        expect(snapshot.markers).toHaveLength(3);
        expect(snapshot.markers[2].label).toBe("mark 5");
        expect(snapshot.droppedMarkers).toBeGreaterThan(0);
    });
});

describe("scene numbering", () => {
    it("numbers a scene once, in the order it was first entered", () => {
        const { collector } = makeCollector();
        expect(collector.sceneOrdinal("scene-a")).toBe(1);
        expect(collector.sceneOrdinal("scene-b")).toBe(2);
        expect(collector.sceneOrdinal("scene-a")).toBe(1);
        expect(collector.snapshot().scenes).toEqual([
            { ordinal: 1, id: "scene-a" },
            { ordinal: 2, id: "scene-b" },
        ]);
    });

    it("has no number for a scene the host could not name", () => {
        const { collector } = makeCollector();
        expect(collector.sceneOrdinal(null)).toBeNull();
        expect(collector.sceneOrdinal("")).toBeNull();
        expect(collector.snapshot().scenes).toEqual([]);
    });

    it("keeps the numbering across a reset, so two reports of one run agree", () => {
        const { collector } = makeCollector();
        collector.sceneOrdinal("scene-a");
        collector.sceneOrdinal("scene-b");
        collector.reset(1);
        expect(collector.sceneOrdinal("scene-b")).toBe(2);
    });
});

describe("reset", () => {
    it("clears the window but keeps what the process is still holding", () => {
        const { collector, advance } = makeCollector();
        feedFrames(collector, [16, 16, 16]);
        collector.request({ url: "room.png", durationMs: 5, bytes: 5000 });
        collector.retain("blob:1", "room.png", 5000);
        collector.count("dialogueLines", 12);
        advance(1000);

        collector.reset(1_700_000_100_000);
        const snapshot = collector.snapshot();
        expect(snapshot.frames.samples).toBe(0);
        expect(snapshot.resources.records).toHaveLength(0);
        expect(snapshot.counters.dialogueLines).toBe(0);
        expect(snapshot.startedAtEpochMs).toBe(1_700_000_100_000);
        // Dropping this would report a game that had loaded nothing while holding megabytes.
        expect(snapshot.retained.blobs).toBe(1);
        expect(snapshot.retained.bytes).toBe(5000);
    });
});

describe("quick", () => {
    it("agrees with the full snapshot on everything both report", () => {
        const { collector } = makeCollector();
        feedFrames(collector, [...Array(30).fill(20)]);
        collector.request({ url: "a.png", durationMs: 5, bytes: 1024 });
        collector.request({ url: "b.ogg", durationMs: 5, bytes: 2048 });
        collector.retain("blob:1", "a.png", 1024);

        const quick = collector.quick();
        const snapshot = collector.snapshot();
        expect(quick.fps).toBe(snapshot.frames.fps);
        expect(quick.addresses).toBe(snapshot.resources.totals.addresses);
        expect(quick.requests).toBe(snapshot.resources.totals.requests);
        expect(quick.bytes).toBe(snapshot.resources.totals.bytes);
        expect(quick.retainedBlobs).toBe(snapshot.retained.blobs);
        expect(quick.retainedBytes).toBe(snapshot.retained.bytes);
    });
});
