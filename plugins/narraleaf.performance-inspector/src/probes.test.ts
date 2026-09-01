import { describe, expect, it, vi } from "vitest";
import { PerformanceCollector } from "./collector";
import {
    installFrameSampler,
    installNetworkProbes,
    installResourceTimingObserver,
    type ProbeScope,
} from "./probes";

type FakeBlob = { size: number; type: string };

type FakeScope = ProbeScope & {
    /** Frame callbacks queued by the sampler, so a test can run frames one at a time. */
    frames: Array<(timestamp: number) => void>;
    objectUrls: string[];
    revoked: string[];
    originalFetch: ProbeScope["fetch"];
};

function makeCollector(): { collector: PerformanceCollector; advance: (ms: number) => void } {
    let now = 0;
    const collector = new PerformanceCollector({
        historySeconds: 60,
        startedAtEpochMs: 0,
        now: () => now,
    });
    return { collector, advance: ms => { now += ms; } };
}

/**
 * A browser with just enough on it.
 *
 * Written out rather than mocked from a real one so the tests state exactly which host functions the
 * probes are allowed to depend on: anything missing here is something the probes must already be
 * guarding.
 */
function makeScope(responses: Record<string, { blob: FakeBlob; contentType: string }>): FakeScope {
    let clock = 0;
    let objectUrlCounter = 0;
    const frames: Array<(timestamp: number) => void> = [];
    const objectUrls: string[] = [];
    const revoked: string[] = [];

    const responseProto: Record<string, unknown> = {
        blob(this: { url: string }) {
            return Promise.resolve(responses[this.url]?.blob ?? { size: 0, type: "" });
        },
    };

    const originalFetch: ProbeScope["fetch"] = (...args: unknown[]) => {
        clock += 10;
        const url = String(args[0]);
        const entry = responses[url];
        const response = Object.create(responseProto) as Record<string, unknown>;
        response.url = url;
        response.ok = Boolean(entry);
        response.headers = { get: (name: string) => (name === "content-type" ? entry?.contentType ?? null : null) };
        return Promise.resolve(response);
    };

    const scope: FakeScope = {
        performance: { now: () => clock },
        requestAnimationFrame: callback => {
            frames.push(callback);
            return frames.length;
        },
        cancelAnimationFrame: () => undefined,
        setInterval: () => 1,
        clearInterval: () => undefined,
        fetch: originalFetch,
        Response: { prototype: responseProto },
        URL: {
            createObjectURL: () => {
                objectUrlCounter += 1;
                const url = `blob:fake/${objectUrlCounter}`;
                objectUrls.push(url);
                return url;
            },
            revokeObjectURL: url => {
                revoked.push(url);
            },
        },
        frames,
        objectUrls,
        revoked,
        originalFetch,
    };
    return scope;
}

describe("installFrameSampler", () => {
    it("feeds every frame boundary and reports its own cost", () => {
        const { collector } = makeCollector();
        const scope = makeScope({});
        const teardown = installFrameSampler({ scope, collector });

        // The fake clock only moves inside fetch, so the overhead measured here is a true zero -
        // which is the point: the number is measured, not assumed.
        scope.frames.shift()?.(0);
        scope.frames.shift()?.(16);
        scope.frames.shift()?.(32);

        const snapshot = collector.snapshot();
        expect(snapshot.frames.samples).toBe(2);
        expect(snapshot.overhead.frames).toBe(3);
        teardown();
        expect(scope.frames).toHaveLength(1);
    });

    it("stops feeding after teardown, even if a queued frame still fires", () => {
        const { collector } = makeCollector();
        const scope = makeScope({});
        const teardown = installFrameSampler({ scope, collector });
        const queued = scope.frames.shift();
        teardown();
        queued?.(16);
        expect(collector.snapshot().overhead.frames).toBe(0);
    });
});

describe("installNetworkProbes", () => {
    it("records a fetch and hands back the very response the caller asked for", async () => {
        const { collector } = makeCollector();
        const scope = makeScope({ "room.png": { blob: { size: 2048, type: "image/png" }, contentType: "image/png" } });
        installNetworkProbes({ scope, collector });

        const response = await (scope.fetch!("room.png") as unknown as Promise<{ url: string }>);
        expect(response.url).toBe("room.png");

        const record = collector.snapshot().resources.records[0];
        expect(record.url).toBe("room.png");
        expect(record.requests).toBe(1);
        expect(record.totalMs).toBe(10);
        expect(record.kind).toBe("image");
    });

    it("learns the size when the body is read, and ties the blob to its address", async () => {
        const { collector } = makeCollector();
        const scope = makeScope({ "room.png": { blob: { size: 2048, type: "image/png" }, contentType: "image/png" } });
        installNetworkProbes({ scope, collector });

        const response = await (scope.fetch!("room.png") as unknown as Promise<{ blob(): Promise<FakeBlob> }>);
        const blob = await response.blob();
        expect(blob.size).toBe(2048);
        expect(collector.snapshot().resources.records[0].bytes).toBe(2048);

        const objectUrl = scope.URL!.createObjectURL!(blob);
        const held = collector.snapshot();
        expect(held.retained.blobs).toBe(1);
        expect(held.retained.bytes).toBe(2048);
        expect(held.resources.records[0].retainedBlobs).toBe(1);

        scope.URL!.revokeObjectURL!(objectUrl);
        expect(collector.snapshot().retained.blobs).toBe(0);
        // Still delegated, so the browser really does free it.
        expect(scope.revoked).toEqual([objectUrl]);
    });

    it("restores every function it replaced", async () => {
        const { collector } = makeCollector();
        const scope = makeScope({});
        const originalCreate = scope.URL!.createObjectURL;
        const originalBlob = scope.Response!.prototype.blob;

        const teardown = installNetworkProbes({ scope, collector });
        expect(scope.fetch).not.toBe(scope.originalFetch);
        teardown();

        expect(scope.fetch).toBe(scope.originalFetch);
        expect(scope.URL!.createObjectURL).toBe(originalCreate);
        expect(scope.Response!.prototype.blob).toBe(originalBlob);
    });

    it("refuses to wrap its own wrapper", () => {
        const { collector } = makeCollector();
        const scope = makeScope({});
        installNetworkProbes({ scope, collector });
        const afterFirst = scope.fetch;
        installNetworkProbes({ scope, collector });
        expect(scope.fetch).toBe(afterFirst);
    });

    it("keeps working when the recording side throws", () => {
        const { collector } = makeCollector();
        const scope = makeScope({});
        vi.spyOn(collector, "retain").mockImplementation(() => {
            throw new Error("recording is broken");
        });
        installNetworkProbes({ scope, collector });

        // The game asked for an object URL. It gets one, whatever the profiler is doing.
        expect(scope.URL!.createObjectURL!({ size: 10 })).toBe("blob:fake/1");
    });

    it("propagates a failure from the original untouched, and counts it", async () => {
        const { collector } = makeCollector();
        const scope = makeScope({});
        scope.fetch = () => Promise.reject(new Error("offline")) as never;
        installNetworkProbes({ scope, collector });

        await expect(scope.fetch!("gone.png") as unknown as Promise<unknown>).rejects.toThrow("offline");
        expect(collector.snapshot().resources.totals.failed).toBe(1);
    });
});

describe("installResourceTimingObserver", () => {
    it("takes the kind from the initiator when the address does not name one", () => {
        const { collector } = makeCollector();
        let deliver: ((entries: unknown[]) => void) | null = null;
        const scope: ProbeScope = {
            performance: { now: () => 0 },
            PerformanceObserver: class {
                public constructor(callback: (list: { getEntries(): never[] }) => void) {
                    deliver = entries => callback({ getEntries: () => entries as never[] });
                }
                public observe(): void {
                    return undefined;
                }
                public disconnect(): void {
                    return undefined;
                }
            } as unknown as ProbeScope["PerformanceObserver"],
        };
        installResourceTimingObserver({ scope, collector });
        expect(deliver).not.toBeNull();
        deliver!([
            { name: "nlgame://asset/9f8c1b", startTime: 5, duration: 20, initiatorType: "img", encodedBodySize: 0 },
        ]);
        const record = collector.snapshot().resources.records[0];
        expect(record.kind).toBe("image");
        expect(record.totalMs).toBe(20);
    });
});
