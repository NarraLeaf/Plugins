/**
 * AutoHighlight — the pure planner.
 *
 * This is the whole intellectual core of the plugin, deliberately free of any Studio or
 * NarraLeaf-React dependency: it turns an ordered list of a scene's compile units into a
 * per-unit plan of darken operations. The compile-pass adapter (runtime entry) is a thin
 * shell that maps the real story blocks onto {@link Unit}s, calls {@link plan}, and renders
 * each {@link DarkenOp} as `image.darken(...)` inside `Control.allAsync`.
 *
 * The design (see docs/plans/2026-07-15-003 in the Studio repo):
 *  - The speaker is highlit (darkness 0) and everyone else is darkened, per dialogue line.
 *  - "Said their piece → darken" fires at the END of a run (a maximal same-speaker stretch),
 *    not per line, so a character speaking several lines in a row does not flicker.
 *  - Auto darkens are guarded by a runtime `enabled` flag (Enable/Disable markers); manual
 *    markers (Highlight / Highlight All / Darken All) and Disable's clear are unconditional.
 *  - Excluded characters are never touched.
 *
 * Everything here is compile-time-structural. The `enabled` flag is runtime state, so the
 * planner does not track it; it only tags which emitted ops are guarded by it.
 */

export type CharacterId = string;

/** One unit of a scene's linear execution order, as the compile pass walks it. */
export type Unit =
    /** A dialogue line. `speaker` is null for narration (no speaker). */
    | { kind: "dialogue"; speaker: CharacterId | null }
    /** An AutoHighlight marker block. */
    | { kind: "marker"; marker: Marker }
    /** Any other block that does NOT express "who is speaking" (set background, wait, …). */
    | { kind: "other" }
    /** A control-flow edge (branch enter/exit, jump). Always breaks a run. */
    | { kind: "boundary" };

export type Marker =
    | { op: "enable" }
    | { op: "disable" }
    | { op: "highlight"; characters: CharacterId[] }
    | { op: "highlightAll" }
    | { op: "darkenAll" };

export interface PlanConfig {
    /** Darken strength for non-speakers, 0..1 (clamped). */
    amount: number;
    durationMs: number;
    easing: string;
    /** Whether a narration line breaks a speaker's run (config-driven, see plan §3.5). */
    narrationBreaksRun: boolean;
    /** Characters that are never darkened. */
    exclude: CharacterId[];
}

/** Auto ops run only while the runtime `enabled` flag is set; manual ops always run. */
export type Guard = "enabled" | "always";

/** darkness 0 = restore to normal (highlight); `amount` = darkened. */
export interface DarkenOp {
    target: CharacterId;
    darkness: number;
}

/** A group of darken ops emitted together (rendered as one `Control.allAsync`). */
export interface OpGroup {
    guard: Guard;
    ops: DarkenOp[];
}

/** What to inject around one unit. */
export interface Injection {
    /** Emitted before the unit's own block. */
    before: OpGroup[];
    /** Emitted after the unit's own block. */
    after: OpGroup[];
    /** For Enable/Disable markers: the runtime flag write (with an undo cleaner in the adapter). */
    setEnabled?: boolean;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Build the effective roster: the scene's characters minus the excluded ones, de-duplicated,
 * order preserved. Excluded characters never appear in any op, which is what "never darkened"
 * means — including that a clear (darken 0) never touches them either.
 */
function effectiveRoster(roster: CharacterId[], exclude: CharacterId[]): CharacterId[] {
    const excluded = new Set(exclude);
    const seen = new Set<CharacterId>();
    const out: CharacterId[] = [];
    for (const c of roster) {
        if (excluded.has(c) || seen.has(c)) continue;
        seen.add(c);
        out.push(c);
    }
    return out;
}

/**
 * Is the dialogue at `index` the last line of its run? A run is a maximal stretch of the same
 * speaker's lines; "other" units do not break it, narration breaks it only when configured to,
 * and a different speaker / marker / boundary always breaks it.
 */
function isRunEnd(units: Unit[], index: number, narrationBreaksRun: boolean): boolean {
    const here = units[index];
    if (here.kind !== "dialogue" || here.speaker === null) return false;
    const speaker = here.speaker;

    for (let j = index + 1; j < units.length; j++) {
        const u = units[j];
        if (u.kind === "other") continue; // non-speech blocks never break a run
        if (u.kind === "dialogue") {
            if (u.speaker === null) {
                // narration: a breaker only when configured; otherwise transparent
                if (narrationBreaksRun) return true;
                continue;
            }
            return u.speaker !== speaker; // same speaker continues the run; a different one ends it
        }
        // marker or boundary
        return true;
    }
    return true; // end of scene ends the run
}

/**
 * Produce a per-unit injection plan. `plan(units, roster, config)[i]` describes what to inject
 * around `units[i]`. Pure and total: every input index gets an entry.
 */
export function plan(units: Unit[], roster: CharacterId[], config: PlanConfig): Injection[] {
    const amount = clamp01(config.amount);
    const cast = effectiveRoster(roster, config.exclude);

    const highlightOf = (speaker: CharacterId | null): DarkenOp[] =>
        cast.map(c => ({ target: c, darkness: c === speaker ? 0 : amount }));
    const allAt = (darkness: number): DarkenOp[] => cast.map(c => ({ target: c, darkness }));
    const highlightSet = (chosen: CharacterId[]): DarkenOp[] => {
        const on = new Set(chosen);
        return cast.map(c => ({ target: c, darkness: on.has(c) ? 0 : amount }));
    };

    return units.map((unit, i): Injection => {
        if (unit.kind === "dialogue") {
            if (unit.speaker === null) return { before: [], after: [] }; // narration emits nothing
            const before: OpGroup[] = [{ guard: "enabled", ops: highlightOf(unit.speaker) }];
            const after: OpGroup[] = isRunEnd(units, i, config.narrationBreaksRun)
                ? [{ guard: "enabled", ops: allAt(amount) }] // said their piece → everyone darkens
                : [];
            return { before, after };
        }

        if (unit.kind === "marker") {
            switch (unit.marker.op) {
                case "enable":
                    return { before: [], after: [], setEnabled: true };
                case "disable":
                    // turn auto off AND clear whatever it left on screen
                    return { before: [], after: [{ guard: "always", ops: allAt(0) }], setEnabled: false };
                case "highlight":
                    return { before: [], after: [{ guard: "always", ops: highlightSet(unit.marker.characters) }] };
                case "highlightAll":
                    return { before: [], after: [{ guard: "always", ops: allAt(0) }] };
                case "darkenAll":
                    return { before: [], after: [{ guard: "always", ops: allAt(amount) }] };
            }
        }

        return { before: [], after: [] }; // other / boundary
    });
}
