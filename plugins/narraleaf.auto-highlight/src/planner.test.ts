import { describe, expect, it } from "vitest";
import { plan, type PlanConfig, type Unit } from "./planner";

const CONFIG: PlanConfig = {
    amount: 0.5,
    durationMs: 300,
    easing: "easeOut",
    narrationBreaksRun: true,
    exclude: [],
};

const cfg = (over: Partial<PlanConfig> = {}): PlanConfig => ({ ...CONFIG, ...over });

const say = (speaker: string | null): Unit => ({ kind: "dialogue", speaker });
const enable = (): Unit => ({ kind: "marker", marker: { op: "enable" } });
const disable = (): Unit => ({ kind: "marker", marker: { op: "disable" } });
const highlight = (...c: string[]): Unit => ({ kind: "marker", marker: { op: "highlight", characters: c } });
const highlightAll = (): Unit => ({ kind: "marker", marker: { op: "highlightAll" } });
const darkenAll = (): Unit => ({ kind: "marker", marker: { op: "darkenAll" } });
const other = (): Unit => ({ kind: "other" });
const boundary = (): Unit => ({ kind: "boundary" });

/** darkness of each target in an op group, as a map for order-independent assertions. */
const darkness = (ops: { target: string; darkness: number }[]) =>
    Object.fromEntries(ops.map(o => [o.target, o.darkness]));

const ROSTER = ["alice", "bob", "carol"];

describe("dialogue highlighting", () => {
    it("highlights the speaker and darkens everyone else, guarded by enabled", () => {
        const [inj] = plan([say("alice")], ROSTER, cfg());

        expect(inj.before).toHaveLength(1);
        expect(inj.before[0].guard).toBe("enabled");
        expect(darkness(inj.before[0].ops)).toEqual({ alice: 0, bob: 0.5, carol: 0.5 });
    });

    it("hands the highlight over when the speaker changes", () => {
        const p = plan([say("alice"), say("bob")], ROSTER, cfg());

        expect(darkness(p[0].before[0].ops)).toEqual({ alice: 0, bob: 0.5, carol: 0.5 });
        expect(darkness(p[1].before[0].ops)).toEqual({ alice: 0.5, bob: 0, carol: 0.5 });
    });
});

describe("run detection — 'said their piece → darken'", () => {
    it("darkens everyone only at the END of a multi-line run, not between lines", () => {
        const p = plan([say("alice"), say("alice"), say("alice")], ROSTER, cfg());

        // no line but the last emits a trailing all-darken → no flicker mid-run
        expect(p[0].after).toEqual([]);
        expect(p[1].after).toEqual([]);
        expect(p[2].after).toHaveLength(1);
        expect(p[2].after[0].guard).toBe("enabled");
        expect(darkness(p[2].after[0].ops)).toEqual({ alice: 0.5, bob: 0.5, carol: 0.5 });
    });

    it("a single line is a run of one, so it darkens after itself", () => {
        const [inj] = plan([say("alice")], ROSTER, cfg());
        expect(darkness(inj.after[0].ops)).toEqual({ alice: 0.5, bob: 0.5, carol: 0.5 });
    });

    it("ends the run when the next speaker differs", () => {
        const p = plan([say("alice"), say("bob")], ROSTER, cfg());
        expect(p[0].after).toHaveLength(1); // alice's run ends before bob speaks
        expect(p[1].after).toHaveLength(1); // bob's run ends at end of scene
    });

    it("a non-speech 'other' block does not break a run", () => {
        const p = plan([say("alice"), other(), say("alice")], ROSTER, cfg());
        expect(p[0].after).toEqual([]); // run continues across the other block
        expect(p[2].after).toHaveLength(1); // ...and ends at the second line
    });

    it("a boundary (branch/jump edge) breaks a run", () => {
        const p = plan([say("alice"), boundary(), say("alice")], ROSTER, cfg());
        expect(p[0].after).toHaveLength(1); // run ends at the boundary
        expect(p[2].after).toHaveLength(1);
    });
});

describe("narration and narrationBreaksRun", () => {
    it("narration emits nothing itself", () => {
        const [inj] = plan([say(null)], ROSTER, cfg());
        expect(inj.before).toEqual([]);
        expect(inj.after).toEqual([]);
    });

    it("breaks a run when narrationBreaksRun is true", () => {
        const p = plan([say("alice"), say(null), say("alice")], ROSTER, cfg({ narrationBreaksRun: true }));
        expect(p[0].after).toHaveLength(1); // alice's first line is a run-end (narration breaks)
        expect(p[2].after).toHaveLength(1);
    });

    it("is transparent when narrationBreaksRun is false", () => {
        const p = plan([say("alice"), say(null), say("alice")], ROSTER, cfg({ narrationBreaksRun: false }));
        expect(p[0].after).toEqual([]); // run spans the narration → not a run-end here
        expect(p[2].after).toHaveLength(1); // ...ends at the second alice line
    });
});

describe("Enable / Disable", () => {
    it("Enable sets the runtime flag and emits no darken", () => {
        const [inj] = plan([enable()], ROSTER, cfg());
        expect(inj.setEnabled).toBe(true);
        expect(inj.before).toEqual([]);
        expect(inj.after).toEqual([]);
    });

    it("Disable clears the flag AND unconditionally restores everyone", () => {
        const [inj] = plan([disable()], ROSTER, cfg());
        expect(inj.setEnabled).toBe(false);
        expect(inj.after).toHaveLength(1);
        expect(inj.after[0].guard).toBe("always"); // clear runs even though auto is now off
        expect(darkness(inj.after[0].ops)).toEqual({ alice: 0, bob: 0, carol: 0 });
    });
});

describe("manual overrides (always unconditional)", () => {
    it("Highlight [set] restores the chosen and darkens the rest", () => {
        const [inj] = plan([highlight("bob", "carol")], ROSTER, cfg());
        expect(inj.after[0].guard).toBe("always");
        expect(darkness(inj.after[0].ops)).toEqual({ alice: 0.5, bob: 0, carol: 0 });
    });

    it("Highlight All restores everyone", () => {
        const [inj] = plan([highlightAll()], ROSTER, cfg());
        expect(darkness(inj.after[0].ops)).toEqual({ alice: 0, bob: 0, carol: 0 });
    });

    it("Darken All darkens everyone", () => {
        const [inj] = plan([darkenAll()], ROSTER, cfg());
        expect(darkness(inj.after[0].ops)).toEqual({ alice: 0.5, bob: 0.5, carol: 0.5 });
    });
});

describe("exclude list", () => {
    it("never touches an excluded character, in any op group", () => {
        const p = plan(
            [say("alice"), darkenAll(), highlightAll()],
            ROSTER,
            cfg({ exclude: ["carol"] }),
        );
        for (const inj of p) {
            for (const group of [...inj.before, ...inj.after]) {
                expect(group.ops.map(o => o.target)).not.toContain("carol");
            }
        }
        // and the ops that do fire still cover the non-excluded cast
        expect(darkness(p[0].before[0].ops)).toEqual({ alice: 0, bob: 0.5 });
    });

    it("an excluded speaker is simply left alone (no 0-op emitted for them)", () => {
        const [inj] = plan([say("alice")], ROSTER, cfg({ exclude: ["alice"] }));
        expect(darkness(inj.before[0].ops)).toEqual({ bob: 0.5, carol: 0.5 });
    });
});

describe("config", () => {
    it("clamps amount into 0..1", () => {
        const hi = plan([say("alice")], ROSTER, cfg({ amount: 5 }));
        expect(hi[0].before[0].ops.find(o => o.target === "bob")!.darkness).toBe(1);
        const lo = plan([say("alice")], ROSTER, cfg({ amount: -5 }));
        expect(lo[0].before[0].ops.find(o => o.target === "bob")!.darkness).toBe(0);
    });

    it("returns one injection per input unit, in order", () => {
        const units = [enable(), say("alice"), other(), disable()];
        expect(plan(units, ROSTER, cfg())).toHaveLength(units.length);
    });
});
