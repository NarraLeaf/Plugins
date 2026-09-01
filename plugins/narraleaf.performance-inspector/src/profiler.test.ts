import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type InspectorSettings } from "./settings";
import { Profiler, type ProfilerHost } from "./profiler";
import type { ProbeScope } from "./probes";

type Harness = {
    profiler: Profiler;
    scope: ProbeScope & { originalFetch: ProbeScope["fetch"] };
    logs: Array<{ level: string; message: string }>;
    persisted: Array<{ key: string; value: unknown }>;
    advance: (ms: number) => void;
    frame: (deltaMs: number) => void;
};

function harness(settings: Partial<InspectorSettings> = {}): Harness {
    let clock = 0;
    const frames: Array<(timestamp: number) => void> = [];
    const originalFetch: ProbeScope["fetch"] = () => Promise.resolve({});
    const scope: ProbeScope & { originalFetch: ProbeScope["fetch"] } = {
        performance: { now: () => clock },
        requestAnimationFrame: callback => {
            frames.push(callback);
            return frames.length;
        },
        cancelAnimationFrame: () => undefined,
        setInterval: () => 1,
        clearInterval: () => undefined,
        fetch: originalFetch,
        originalFetch,
    };
    const logs: Array<{ level: string; message: string }> = [];
    const persisted: Array<{ key: string; value: unknown }> = [];
    const host: ProfilerHost = {
        log: (level, message) => logs.push({ level, message }),
        persist: (key, value) => persisted.push({ key, value }),
    };
    const profiler = new Profiler({
        settings: { ...DEFAULT_SETTINGS, ...settings },
        scope,
        host,
        pluginVersion: "0.0.0-test",
        now: () => clock,
        epochNow: () => 1_700_000_000_000 + clock,
    });
    return {
        profiler,
        scope,
        logs,
        persisted,
        advance: ms => { clock += ms; },
        frame: deltaMs => {
            const next = frames.shift();
            if (!next) {
                return;
            }
            clock += deltaMs;
            next(clock);
        },
    };
}

describe("arming", () => {
    it("puts the probes in on start and takes them back out on stop", () => {
        const { profiler, scope } = harness();
        expect(profiler.isRunning()).toBe(false);
        expect(scope.fetch).toBe(scope.originalFetch);

        profiler.start();
        expect(profiler.isRunning()).toBe(true);
        expect(scope.fetch).not.toBe(scope.originalFetch);

        profiler.stop();
        expect(profiler.isRunning()).toBe(false);
        // The game is untouched again - which is what makes `Stop Profiling` worth having.
        expect(scope.fetch).toBe(scope.originalFetch);
    });

    it("can be armed again after being stopped", () => {
        const { profiler, scope } = harness();
        profiler.start();
        profiler.stop();
        profiler.start();
        expect(profiler.isRunning()).toBe(true);
        expect(scope.fetch).not.toBe(scope.originalFetch);
    });

    it("keeps what it measured readable after stopping", () => {
        const { profiler, frame, advance } = harness();
        profiler.start();
        frame(0);
        frame(16);
        frame(16);
        advance(100);
        profiler.stop();
        // Someone who stopped a profile stopped it in order to read the result.
        expect(profiler.snapshot().frames.samples).toBe(2);
    });

    it("does nothing on a second start", () => {
        const { profiler, scope } = harness();
        profiler.start();
        const armed = scope.fetch;
        profiler.start();
        expect(scope.fetch).toBe(armed);
    });
});

describe("startFresh", () => {
    it("arms a profiler that was never started", () => {
        const { profiler, scope } = harness({ collectFrom: "graph" });
        expect(profiler.isRunning()).toBe(false);
        profiler.startFresh();
        expect(profiler.isRunning()).toBe(true);
        expect(scope.fetch).not.toBe(scope.originalFetch);
    });

    it("throws away the window that was already open", () => {
        const { profiler, frame, advance } = harness();
        profiler.start();
        frame(0);
        frame(16);
        frame(16);
        expect(profiler.snapshot().frames.samples).toBe(2);

        advance(500);
        profiler.startFresh();
        const snapshot = profiler.snapshot();
        expect(snapshot.frames.samples).toBe(0);
        expect(snapshot.elapsedMs).toBe(0);
    });

    it("marks the run as one that did not see the boot", () => {
        const { profiler } = harness({ collectFrom: "graph" });
        expect(profiler.snapshot().startedLate).toBe(false);
        profiler.startFresh();
        expect(profiler.snapshot().startedLate).toBe(true);
    });
});

describe("a run started at boot", () => {
    it("does not claim it began late", () => {
        const { profiler } = harness();
        profiler.start();
        expect(profiler.snapshot().startedLate).toBe(false);
    });

    it("does once it has been reset, because that window missed the boot too", () => {
        const { profiler } = harness();
        profiler.start();
        profiler.reset();
        expect(profiler.snapshot().startedLate).toBe(true);
    });
});

describe("capture", () => {
    it("writes the last report to plugin storage so it outlives the run", () => {
        const { profiler, persisted } = harness();
        profiler.start();
        const report = profiler.capture();
        expect(persisted).toHaveLength(1);
        expect(persisted[0].key).toBe("lastReport");
        expect(persisted[0].value).toBe(report);
    });

    it("writes the written summary to the game log when the author asked for it", () => {
        const { profiler, logs } = harness({ logOnCapture: true });
        profiler.start();
        profiler.capture();
        expect(logs.some(entry => entry.message.includes("NarraLeaf Performance Inspector"))).toBe(true);
    });

    it("stays out of the log when they did not", () => {
        const { profiler, logs } = harness({ logOnCapture: false });
        profiler.start();
        profiler.capture();
        expect(logs).toHaveLength(0);
    });
});
