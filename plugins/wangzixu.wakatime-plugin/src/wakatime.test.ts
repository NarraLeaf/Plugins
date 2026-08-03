import { describe, expect, it } from "vitest";
import {
    QUEUE_LIMIT,
    buildHeartbeat,
    chunk,
    classifyStatus,
    encodeApiKey,
    shouldRetry,
    trimQueue,
    userAgent,
    type Heartbeat,
} from "./wakatime";

const base = {
    entity: "NarraLeaf Studio",
    timeMs: 1_700_000_000_000,
    project: "My Visual Novel",
} as const;

describe("buildHeartbeat", () => {
    it("sends seconds, not milliseconds", () => {
        expect(buildHeartbeat(base).time).toBe(1_700_000_000);
    });

    it("omits an empty project rather than filing time under a nameless one", () => {
        expect(buildHeartbeat({ ...base, project: "   " })).not.toHaveProperty("project");
    });

    it("trims what it does send", () => {
        expect(buildHeartbeat({ ...base, project: "  Spaced  " }).project).toBe("Spaced");
    });

    it("carries nothing about the project but its name", () => {
        expect(Object.keys(buildHeartbeat(base)).sort()).toEqual([
            "category",
            "entity",
            "is_write",
            "language",
            "project",
            "time",
            "type",
        ]);
    });
});

describe("classifyStatus", () => {
    it("treats 401 and 403 as an auth failure worth pausing on", () => {
        for (const status of [401, 403]) {
            const outcome = classifyStatus(status);
            expect(outcome).toMatchObject({ ok: false, kind: "auth" });
            expect(shouldRetry(outcome)).toBe(true);
        }
    });

    it("drops a batch the server merely refused", () => {
        const outcome = classifyStatus(400, "bad heartbeat");
        expect(outcome).toMatchObject({ ok: false, kind: "rejected", message: "bad heartbeat" });
        expect(shouldRetry(outcome)).toBe(false);
    });

    it("keeps a batch through rate limits and server trouble", () => {
        expect(shouldRetry(classifyStatus(429))).toBe(true);
        expect(shouldRetry(classifyStatus(503))).toBe(true);
    });

    it("accepts every 2xx, including the 201/202 the bulk endpoint answers", () => {
        for (const status of [200, 201, 202]) {
            expect(classifyStatus(status)).toEqual({ ok: true });
        }
    });
});

describe("queue maintenance", () => {
    const beat = (time: number): Heartbeat => ({ ...buildHeartbeat(base), time });

    it("chunks to the bulk limit", () => {
        expect(chunk(Array.from({ length: 60 }, (_, index) => index), 25).map(part => part.length))
            .toEqual([25, 25, 10]);
    });

    it("leaves a short queue alone", () => {
        const queue = [beat(1), beat(2)];
        expect(trimQueue(queue)).toEqual(queue);
    });

    it("drops the oldest when full, never the newest", () => {
        const queue = Array.from({ length: QUEUE_LIMIT + 3 }, (_, index) => beat(index));
        const trimmed = trimQueue(queue);
        expect(trimmed).toHaveLength(QUEUE_LIMIT);
        expect(trimmed[0].time).toBe(3);
        expect(trimmed[trimmed.length - 1].time).toBe(QUEUE_LIMIT + 2);
    });
});

describe("identification", () => {
    it("names the editor before the plugin, which is how the dashboard reads it", () => {
        expect(userAgent("0.1.0")).toBe("narraleaf-studio/unknown narraleaf-wakatime/0.1.0");
    });

    it("base64-encodes the key for Basic auth", () => {
        expect(encodeApiKey("waka_abc")).toBe("d2FrYV9hYmM=");
    });
});
