/**
 * The Unlock Steam Achievement story row: the row the editor writes, and what the game does when the
 * story reaches it.
 *
 * The bridge keeps one connection per game process in module state, so every case imports a fresh
 * copy of the story module (and the bridge under it).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOG_VERSION, PLUGIN_ID, STORE_KEY_UNLOCKED } from "./catalog";
import { translateEnglish } from "./i18n";

type Story = typeof import("./story");
type RunContext = Parameters<ReturnType<Story["createSteamStoryActions"]>[number]["run"]>[0];

async function freshStory(): Promise<Story> {
    vi.resetModules();
    return import("./story");
}

const catalog = {
    version: CATALOG_VERSION,
    appId: "480",
    achievements: [{ id: "ACH_WIN_ONE_GAME" }, { id: "ACH_TRAVEL_FAR_ACCUM" }],
    stats: [],
};

/** A game with a mirror and a sidecar whose answers can be held back. */
function fakeGame({ steamRunning = true } = {}) {
    const store = new Map<string, unknown>();
    const requests: { method: string; params: unknown }[] = [];
    const logs: string[] = [];
    let releaseInit: () => void = () => {};
    const initGate = new Promise<void>(resolve => {
        releaseInit = resolve;
    });
    const handle = {
        async request(method: string, params?: unknown) {
            requests.push({ method, params });
            if (method === "steam.init") {
                await initGate;
                return { available: steamRunning, appId: steamRunning ? "480" : null, language: null };
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
        sidecar: { available: () => true, start: async () => handle },
    };
    return {
        // The row only reaches `log`, `store` and `sidecar`; the double does not pretend to the rest.
        game: game as unknown as RunContext["game"],
        store,
        requests,
        logs,
        releaseInit: () => releaseInit(),
    };
}

function run(story: Story, game: RunContext["game"], params: Record<string, unknown>) {
    const [action] = story.createSteamStoryActions(() => catalog);
    return action!.run({ params, game, signal: new AbortController().signal });
}

let story: Story;

beforeEach(async () => {
    story = await freshStory();
});

describe("the editor half", () => {
    const action = () => story.createUnlockStoryAction(() => catalog, translateEnglish);
    const create = (initialText?: string) => action().createBlock({ generateId: () => "row-1", initialText });

    it("writes a plugin row its runner answers to, under an id apart from the node's type", () => {
        const block = create("ACH_WIN_ONE_GAME");
        expect(block).toEqual({
            id: "row-1",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: {
                action: "plugin",
                pluginId: PLUGIN_ID,
                actionId: story.UNLOCK_STORY_ACTION_ID,
                params: { achievementId: "ACH_WIN_ONE_GAME" },
            },
        });
        expect(story.UNLOCK_STORY_ACTION_ID).not.toBe(`${PLUGIN_ID}.unlock`);
        expect(story.createSteamStoryActions(() => catalog).map(def => def.id)).toEqual([story.UNLOCK_STORY_ACTION_ID]);
    });

    it("lands a typed name on the catalog's spelling, and keeps one the catalog does not have", () => {
        expect(create("  ach_win_one_game ")).toMatchObject({ payload: { params: { achievementId: "ACH_WIN_ONE_GAME" } } });
        expect(create("ACH_TYPO")).toMatchObject({ payload: { params: { achievementId: "ACH_TYPO" } } });
    });

    it("leaves a row picked from the menu without an achievement", () => {
        expect(create()).toMatchObject({ payload: { params: {} } });
        expect(create("   ")).toMatchObject({ payload: { params: {} } });
    });

    it("offers the node's own achievement pick in the inspector", () => {
        expect(action().params).toEqual([
            { key: "achievementId", label: "Achievement", kind: "select", dynamicOptionsSource: `${PLUGIN_ID}.achievements` },
        ]);
    });

    it("reads as the achievement it unlocks", () => {
        expect(action().describe?.({ achievementId: "ACH_WIN_ONE_GAME" })).toBe("Unlock Steam achievement ACH_WIN_ONE_GAME");
        expect(action().describe?.({})).toBe("Unlock Steam achievement Unassigned");
    });
});

describe("the game half", () => {
    it("saves the unlock on the device before Steam has answered, and Steam hears of it once it does", async () => {
        const fake = fakeGame();
        // The row settles while `steam.init` is still held: the story never waits on the bridge.
        await run(story, fake.game, { achievementId: "ACH_WIN_ONE_GAME" });
        expect(fake.store.get(STORE_KEY_UNLOCKED)).toEqual(["ACH_WIN_ONE_GAME"]);
        expect(fake.requests.map(request => request.method)).toEqual(["steam.init"]);

        fake.releaseInit();
        await vi.waitFor(() => {
            expect(fake.requests.filter(request => request.method === "achievements.unlock").map(request => request.params))
                .toContainEqual({ id: "ACH_WIN_ONE_GAME" });
        });
    });

    it("keeps the unlock on the device when Steam is not running", async () => {
        const fake = fakeGame({ steamRunning: false });
        fake.releaseInit();
        await run(story, fake.game, { achievementId: "ACH_TRAVEL_FAR_ACCUM" });
        expect(fake.store.get(STORE_KEY_UNLOCKED)).toEqual(["ACH_TRAVEL_FAR_ACCUM"]);
        await vi.waitFor(() => expect(fake.requests.map(request => request.method)).toEqual(["steam.init"]));
    });

    it("unlocks nothing, and says so, on a row with no achievement picked", async () => {
        const fake = fakeGame();
        await run(story, fake.game, {});
        expect(fake.store.has(STORE_KEY_UNLOCKED)).toBe(false);
        expect(fake.requests).toEqual([]);
        expect(fake.logs).toEqual([expect.stringMatching(/^warning: .*no achievement picked/)]);
    });
});
