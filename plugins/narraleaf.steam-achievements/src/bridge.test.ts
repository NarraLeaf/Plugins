/**
 * The bridge's replay: what reaches Steam when a connection opens.
 *
 * The bridge keeps one connection per game process in module state, so every
 * case imports a fresh copy of the module.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_KEY_UNLOCKED } from "./catalog";

type Bridge = typeof import("./bridge");

async function freshBridge(): Promise<Bridge> {
    vi.resetModules();
    return import("./bridge");
}

/** A game with a mirror and a sidecar that records every request it is sent. */
function fakeGame({
    unlocked = [] as string[],
    steamRunning = true,
    sidecar = true,
    failUnlockOf = [] as string[],
} = {}) {
    const store = new Map<string, unknown>([[STORE_KEY_UNLOCKED, unlocked]]);
    const requests: { method: string; params: unknown }[] = [];
    const logs: string[] = [];
    let started = 0;
    const handle = {
        async request(method: string, params?: unknown) {
            requests.push({ method, params });
            if (method === "steam.init") {
                return { available: steamRunning, appId: steamRunning ? "480" : null, language: null };
            }
            const id = (params as { id?: string } | undefined)?.id;
            if (method === "achievements.unlock" && id && failUnlockOf.includes(id)) {
                throw new Error(`SetAchievement(${id}) failed`);
            }
            return {};
        },
        notify() {},
        onEvent: () => () => {},
        onExit: () => () => {},
        stop: async () => {},
    };
    const game = {
        log: (level: string, message: string) => {
            logs.push(`${level}: ${message}`);
        },
        store: {
            get: async (key: string) => store.get(key),
            set: async (key: string, value: unknown) => {
                store.set(key, value);
            },
        },
        sidecar: sidecar
            ? {
                available: () => true,
                start: async () => {
                    started += 1;
                    return handle;
                },
            }
            : undefined,
    };
    return {
        // The bridge only touches `log`, `store` and `sidecar`; the rest of the game is not
        // reached, so the double does not pretend to have it.
        game: game as unknown as Parameters<Bridge["steamStatus"]>[0],
        requests,
        logs,
        started: () => started,
    };
}

let bridge: Bridge;

beforeEach(async () => {
    bridge = await freshBridge();
});

describe("connectIfUnlocked", () => {
    it("starts no process for a player who has unlocked nothing", async () => {
        const fake = fakeGame();
        await bridge.connectIfUnlocked(fake.game, "480");
        expect(fake.started()).toBe(0);
        expect(fake.requests).toEqual([]);
    });

    it("sends Steam every achievement the mirror holds, after init", async () => {
        const fake = fakeGame({ unlocked: ["ACH_A", "ACH_B"] });
        await bridge.connectIfUnlocked(fake.game, "480");
        expect(fake.requests).toEqual([
            { method: "steam.init", params: { appId: "480" } },
            { method: "achievements.unlock", params: { id: "ACH_A" } },
            { method: "achievements.unlock", params: { id: "ACH_B" } },
        ]);
    });

    it("sends nothing past init when Steam is not running", async () => {
        const fake = fakeGame({ unlocked: ["ACH_A"], steamRunning: false });
        await bridge.connectIfUnlocked(fake.game, "480");
        expect(fake.requests.map(request => request.method)).toEqual(["steam.init"]);
    });

    it("is quiet wherever there is no bridge to start", async () => {
        const fake = fakeGame({ unlocked: ["ACH_A"], sidecar: false });
        await bridge.connectIfUnlocked(fake.game, "480");
        expect(fake.requests).toEqual([]);
    });

    it("logs an unlock Steam refuses and goes on with the rest", async () => {
        const fake = fakeGame({ unlocked: ["GONE", "ACH_B"], failUnlockOf: ["GONE"] });
        await bridge.connectIfUnlocked(fake.game, "480");
        expect(fake.requests.map(request => request.params)).toContainEqual({ id: "ACH_B" });
        expect(fake.logs).toEqual([expect.stringContaining("GONE")]);
    });
});

describe("the replay and a node's own write", () => {
    it("replays once per connection, before the first echo", async () => {
        const fake = fakeGame({ unlocked: ["ACH_A"] });
        await bridge.echo(fake.game, "480", "achievements.unlock", { id: "ACH_NEW" });
        await bridge.echo(fake.game, "480", "stats.set", { id: "S", type: "int", value: 1 });
        expect(fake.started()).toBe(1);
        expect(fake.requests.map(request => [request.method, request.params])).toEqual([
            ["steam.init", { appId: "480" }],
            ["achievements.unlock", { id: "ACH_A" }],
            ["achievements.unlock", { id: "ACH_NEW" }],
            ["stats.set", { id: "S", type: "int", value: 1 }],
        ]);
    });

    it("does not replay stats", async () => {
        const fake = fakeGame({ unlocked: ["ACH_A"] });
        await fake.game.store?.set("narraleaf.steam-achievements.stats", { S: 5 });
        await bridge.connectIfUnlocked(fake.game, "480");
        expect(fake.requests.some(request => request.method === "stats.set")).toBe(false);
    });
});
