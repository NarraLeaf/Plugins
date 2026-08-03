import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTracker, shouldRecord, type TrackerConfig } from "./tracker";
import { HEARTBEAT_INTERVAL_MS, type Heartbeat } from "./wakatime";

describe("shouldRecord", () => {
    it("records the first activity of a session immediately", () => {
        expect(shouldRecord(null, 1_000, true)).toBe(true);
    });

    it("holds off until a full interval has passed", () => {
        expect(shouldRecord(1_000, 1_000 + HEARTBEAT_INTERVAL_MS - 1, true)).toBe(false);
        expect(shouldRecord(1_000, 1_000 + HEARTBEAT_INTERVAL_MS, true)).toBe(true);
    });

    it("records nothing for a window that is not on screen", () => {
        expect(shouldRecord(null, 1_000, false)).toBe(false);
    });
});

const CONFIG: TrackerConfig = {
    enabled: true,
    apiKey: "waka_test",
    entity: "NarraLeaf Studio",
    project: "My Visual Novel",
    userAgent: "narraleaf-studio/unknown narraleaf-wakatime/0.1.0",
};

function harness(config: Partial<TrackerConfig> = {}, initial: Heartbeat[] = []) {
    let queue = [...initial];
    const tracker = createTracker({
        readConfig: () => ({ ...CONFIG, ...config }),
        readQueue: () => [...queue],
        writeQueue: next => {
            queue = [...next];
        },
        now: () => 1_700_000_000_000,
        isVisible: () => true,
    });
    return { tracker, queue: () => queue };
}

function beat(time: number): Heartbeat {
    return { entity: "NarraLeaf Studio", type: "app", time, is_write: false };
}

function respond(status: number) {
    return vi.fn(async () => new Response("{}", { status }));
}

let fetchSpy: ReturnType<typeof respond>;

beforeEach(() => {
    fetchSpy = respond(201);
    vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("flush", () => {
    it("drains an accepted queue", async () => {
        const { tracker, queue } = harness({}, [beat(1), beat(2)]);
        await tracker.flush();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(queue()).toEqual([]);
        expect(tracker.status().error).toBeNull();
    });

    it("splits a long queue into bulk-sized requests", async () => {
        const { tracker, queue } = harness({}, Array.from({ length: 60 }, (_, index) => beat(index)));
        await tracker.flush();
        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(queue()).toEqual([]);
    });

    it("keeps the queue and parks on a rejected key, and stays parked", async () => {
        fetchSpy = respond(401);
        vi.stubGlobal("fetch", fetchSpy);
        const { tracker, queue } = harness({}, [beat(1)]);

        await tracker.flush();
        expect(queue()).toHaveLength(1);
        expect(tracker.status().pausedForAuth).toBe(true);
        expect(tracker.status().error?.kind).toBe("auth");

        // A wrong key does not become right on a timer.
        await tracker.flush();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("tries again once the author resumes it", async () => {
        fetchSpy = respond(401);
        vi.stubGlobal("fetch", fetchSpy);
        const { tracker } = harness({}, [beat(1)]);
        await tracker.flush();

        tracker.resume();
        await tracker.flush();
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(tracker.status().pausedForAuth).toBe(false);
    });

    it("drops a batch the server refused outright, rather than retrying it forever", async () => {
        fetchSpy = respond(400);
        vi.stubGlobal("fetch", fetchSpy);
        const { tracker, queue } = harness({}, [beat(1)]);
        await tracker.flush();
        expect(queue()).toEqual([]);
        expect(tracker.status().error?.kind).toBe("rejected");
    });

    it("keeps the queue through a server outage", async () => {
        fetchSpy = respond(503);
        vi.stubGlobal("fetch", fetchSpy);
        const { tracker, queue } = harness({}, [beat(1)]);
        await tracker.flush();
        expect(queue()).toHaveLength(1);
        expect(tracker.status().pausedForAuth).toBe(false);
    });

    it("sends nothing while the setup is incomplete", async () => {
        for (const config of [{ apiKey: "" }, { project: "" }, { enabled: false }]) {
            const { tracker, queue } = harness(config, [beat(1)]);
            await tracker.flush();
            expect(queue()).toHaveLength(1);
        }
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});

describe("recordNow", () => {
    it("records and sends one heartbeat regardless of the interval", async () => {
        const { tracker, queue } = harness();
        await tracker.recordNow();
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(queue()).toEqual([]);
        expect(tracker.status().lastHeartbeatAt).toBe(1_700_000_000_000);
    });

    it("records nothing when there is no project to record against", async () => {
        const { tracker, queue } = harness({ project: "" });
        await tracker.recordNow();
        expect(queue()).toEqual([]);
        expect(tracker.status().lastHeartbeatAt).toBeNull();
    });
});
