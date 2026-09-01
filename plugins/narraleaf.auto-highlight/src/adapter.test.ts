import { describe, expect, it, vi } from "vitest";
import { applyToScene } from "./adapter";
import { DEFAULT_CONFIG, type AutoHighlightConfig } from "./config";
import { ACTION_IDS, PLUGIN_ID } from "./actions";
import type {
    SceneCompileContext,
    CompileBlockView,
    EngineAction,
    RuntimeFlag,
    BlockInjection,
    StageImage,
} from "./contract";

/**
 * A fake compile context that records what the adapter builds and attaches, without any engine.
 * Engine actions are represented as tagged plain objects so assertions can read their structure.
 */
type FakeAction =
    | { t: "darken"; target: string; darkness: number }
    | { t: "parallel"; of: FakeAction[] }
    | { t: "guarded"; actions: FakeAction[] }
    | { t: "setFlag"; value: boolean };

function fakeContext(
    blocks: CompileBlockView[],
    opts: { roster: string[]; absent?: string[] } = { roster: [] },
) {
    const injected: Record<string, BlockInjection> = {};
    const absent = new Set(opts.absent ?? []);
    const flag: RuntimeFlag = {
        write: (value: boolean) => ({ t: "setFlag", value } as unknown as EngineAction),
    };

    const ctx: SceneCompileContext = {
        blocks,
        roster: () => opts.roster,
        resolveCharacterImage: (name: string): StageImage | null =>
            absent.has(name)
                ? null
                : { darken: (darkness, _d, _e) => ({ t: "darken", target: name, darkness } as unknown as EngineAction) },
        parallel: (actions) => ({ t: "parallel", of: actions as unknown as FakeAction[] } as unknown as EngineAction),
        guarded: (_flag, actions) => ({ t: "guarded", actions: actions as unknown as FakeAction[] } as unknown as EngineAction),
        runtimeFlag: () => flag,
        inject: vi.fn((id: string, injection: BlockInjection) => {
            injected[id] = injection;
        }),
    };
    return { ctx, injected };
}

const asFake = (a: EngineAction | undefined): FakeAction => a as unknown as FakeAction;
const cfg = (over: Partial<AutoHighlightConfig> = {}): AutoHighlightConfig => ({ ...DEFAULT_CONFIG, ...over });

const dialogue = (id: string, speaker: string | null): CompileBlockView => ({ kind: "dialogue", id, speaker });
const pluginAction = (id: string, actionId: string, params: Record<string, unknown> = {}): CompileBlockView =>
    ({ kind: "pluginAction", id, pluginId: PLUGIN_ID, actionId, params });

/** A marker row belonging to some other plugin, which this pass must treat as an ordinary row. */
const foreignAction = (id: string, actionId: string): CompileBlockView =>
    ({ kind: "pluginAction", id, pluginId: "someone.else", actionId, params: {} });

describe("adapter — dialogue rendering", () => {
    it("wraps the speaker highlight in a guarded parallel darken", () => {
        const { ctx, injected } = fakeContext([dialogue("d1", "alice")], { roster: ["alice", "bob"] });
        applyToScene(ctx, cfg());

        const before = asFake(injected["d1"].before![0]);
        expect(before.t).toBe("guarded"); // auto darkens are enabled-guarded
        const parallel = (before as Extract<FakeAction, { t: "guarded" }>).actions[0];
        expect(parallel.t).toBe("parallel"); // ...and fanned out in parallel
        const darkens = (parallel as Extract<FakeAction, { t: "parallel" }>).of;
        expect(darkens).toEqual([
            { t: "darken", target: "alice", darkness: 0 },
            { t: "darken", target: "bob", darkness: 0.5 },
        ]);
    });

    it("skips characters that never enter the scene, and drops an all-absent group", () => {
        const { ctx, injected } = fakeContext([dialogue("d1", "alice")], {
            roster: ["alice", "ghost"],
            absent: ["ghost"], // ghost is in the cast list but never enters
        });
        applyToScene(ctx, cfg());

        const parallel = (asFake(injected["d1"].before![0]) as Extract<FakeAction, { t: "guarded" }>).actions[0];
        const darkens = (parallel as Extract<FakeAction, { t: "parallel" }>).of;
        expect(darkens.map(d => (d as Extract<FakeAction, { t: "darken" }>).target)).toEqual(["alice"]);
    });
});

describe("adapter — markers", () => {
    it("Enable injects the flag write and nothing else", () => {
        const { ctx, injected } = fakeContext([pluginAction("m1", ACTION_IDS.enable)], { roster: ["alice"] });
        applyToScene(ctx, cfg());

        expect(injected["m1"].before ?? []).toEqual([]);
        expect(injected["m1"].after).toEqual([{ t: "setFlag", value: true }]);
    });

    it("Disable writes the flag false then unconditionally restores everyone", () => {
        const { ctx, injected } = fakeContext([pluginAction("m1", ACTION_IDS.disable)], { roster: ["alice", "bob"] });
        applyToScene(ctx, cfg());

        const after = injected["m1"].after!.map(asFake);
        expect(after[0]).toEqual({ t: "setFlag", value: false });
        // the clear is unconditional (parallel, not guarded) and sets everyone to 0
        expect(after[1].t).toBe("parallel");
        expect((after[1] as Extract<FakeAction, { t: "parallel" }>).of).toEqual([
            { t: "darken", target: "alice", darkness: 0 },
            { t: "darken", target: "bob", darkness: 0 },
        ]);
    });

    it("Highlight Characters reads its multi-select params (unconditional)", () => {
        const { ctx, injected } = fakeContext(
            [pluginAction("m1", ACTION_IDS.highlight, { characters: ["bob"] })],
            { roster: ["alice", "bob"] },
        );
        applyToScene(ctx, cfg());

        const group = asFake(injected["m1"].after![0]);
        expect(group.t).toBe("parallel"); // manual override → unconditional
        expect((group as Extract<FakeAction, { t: "parallel" }>).of).toEqual([
            { t: "darken", target: "alice", darkness: 0.5 },
            { t: "darken", target: "bob", darkness: 0 },
        ]);
    });
});

describe("adapter — markers that are not ours", () => {
    it("treats another plugin's marker as an ordinary row, so it does not break a run", () => {
        // Alice speaks either side of a foreign marker. If the marker were read as a boundary, the
        // first line would end her run and darken everyone mid-sentence - installing an unrelated
        // plugin would change where this one dims.
        const { ctx, injected } = fakeContext(
            [dialogue("d1", "alice"), foreignAction("f1", "someone.else.thing"), dialogue("d2", "alice")],
            { roster: ["alice", "bob"] },
        );
        applyToScene(ctx, cfg());

        expect(injected["f1"]).toBeUndefined();
        expect(injected["d1"].after ?? []).toHaveLength(0);
        expect(injected["d2"].after).toHaveLength(1);
    });

    it("treats an unrecognized marker of our own as neutral rather than guessing", () => {
        const { ctx, injected } = fakeContext(
            [dialogue("d1", "alice"), pluginAction("m1", "narraleaf.auto-highlight.from-the-future"), dialogue("d2", "alice")],
            { roster: ["alice", "bob"] },
        );
        applyToScene(ctx, cfg());

        expect(injected["m1"]).toBeUndefined();
        expect(injected["d1"].after ?? []).toHaveLength(0);
    });
});

describe("adapter — nothing to do", () => {
    it("does not inject on a plain block with no cast", () => {
        const { ctx, injected } = fakeContext([{ kind: "other", id: "x" }], { roster: [] });
        applyToScene(ctx, cfg());
        expect(injected["x"]).toBeUndefined();
        expect(ctx.inject).not.toHaveBeenCalled();
    });
});
