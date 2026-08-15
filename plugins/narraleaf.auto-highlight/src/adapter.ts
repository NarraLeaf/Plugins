/**
 * The bridge between the pure planner and the Studio compile context.
 *
 * Kept separate from runtime.ts (the thin `defineRuntimePlugin` shell) so it can be unit
 * tested against a fake context without any engine present: everything here is ordinary data
 * transformation. It maps the scene's blocks onto planner {@link Unit}s, runs {@link plan},
 * and renders each {@link OpGroup} back into engine actions through the context.
 */

import { plan, type Unit, type OpGroup } from "./planner";
import { markerFor, PLUGIN_ID } from "./actions";
import { type AutoHighlightConfig } from "./config";
import type {
    SceneCompileContext,
    CompileBlockView,
    EngineAction,
    RuntimeFlag,
} from "./contract";

/** Scene-local flag name that gates the automatic highlighting. */
const ENABLED_FLAG = "narraleaf.auto-highlight:enabled";

/** Classify one block view into the planner's unit vocabulary. */
function toUnit(block: CompileBlockView): Unit {
    switch (block.kind) {
        case "dialogue":
            return { kind: "dialogue", speaker: block.speaker };
        case "pluginAction": {
            // Another plugin's marker is just a row that happens to be in the way: it says nothing
            // about who is speaking, so it is `other` and does not break a run. Reading it as a
            // boundary would let installing an unrelated plugin change where this one darkens.
            if (block.pluginId !== PLUGIN_ID) {
                return { kind: "other" };
            }
            const marker = markerFor(block.actionId, block.params);
            // One of ours we do not recognize - a row authored by a newer version - is neutral too,
            // rather than a guess at what it might have meant.
            return marker ? { kind: "marker", marker } : { kind: "other" };
        }
        case "boundary":
            return { kind: "boundary" };
        case "other":
        default:
            return { kind: "other" };
    }
}

/**
 * Render one darken group into a single engine action, or null when nothing lands on stage
 * (every target is a character that never enters this scene — darkening it would be a no-op,
 * so we skip the empty allAsync entirely).
 */
function renderGroup(
    ctx: SceneCompileContext,
    flag: RuntimeFlag,
    group: OpGroup,
    config: AutoHighlightConfig,
): EngineAction | null {
    const darkens: EngineAction[] = [];
    for (const op of group.ops) {
        const image = ctx.resolveCharacterImage(op.target);
        if (!image) continue; // character never enters this scene → nothing to darken
        darkens.push(image.darken(op.darkness, config.durationMs, config.easing));
    }
    if (darkens.length === 0) return null;

    const fanned = ctx.parallel(darkens); // allAsync: parallel, non-blocking (plan §3.7)
    return group.guard === "enabled" ? ctx.guarded(flag, [fanned]) : fanned;
}

/**
 * Plan and inject AutoHighlight for one scene. Pure w.r.t. the engine: it only asks `ctx` to
 * build and attach actions. Safe to run on every scene; emits nothing for scenes with no cast.
 * `config` is the already-normalized project config (the runtime entry reads and normalizes it
 * once from `app.game.data`).
 */
export function applyToScene(ctx: SceneCompileContext, config: AutoHighlightConfig): void {
    const blocks = ctx.blocks;
    const units = blocks.map(toUnit);
    const injections = plan(units, ctx.roster(), config);
    const flag = ctx.runtimeFlag(ENABLED_FLAG);

    injections.forEach((inj, i) => {
        const block = blocks[i];
        const before = inj.before
            .map(g => renderGroup(ctx, flag, g, config))
            .filter((a): a is EngineAction => a !== null);

        const after: EngineAction[] = [];
        // Enable/Disable write the runtime flag first, then any clear it carries.
        if (inj.setEnabled !== undefined) {
            after.push(flag.write(inj.setEnabled));
        }
        for (const group of inj.after) {
            const action = renderGroup(ctx, flag, group, config);
            if (action) after.push(action);
        }

        if (before.length === 0 && after.length === 0) return;
        ctx.inject(block.id, { before, after });
    });
}
