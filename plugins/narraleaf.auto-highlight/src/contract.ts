/**
 * The Studio compile-pass contract this plugin is written against.
 *
 * ⚠️ This surface is NOT yet in the published `narraleaf-studio` package. It is the precise
 * specification of the extension point Studio must add (plan 2026-07-15-003, §3.10 / §4). The
 * runtime entry codes against these types today so that, the moment Studio ships them, wiring
 * is a cast away — and so the contract is reviewable as code, not prose.
 *
 * Design boundary: the plugin owns the darken *plan* (see planner.ts). Studio owns every piece
 * of engine correctness — parallel non-blocking fan-out, the runtime flag whose undo cleaner
 * must be exactly right (plan hard-constraint 3), and resolving a character to its stage Image.
 * The plugin never touches NarraLeaf-React directly; it only asks the context to emit things.
 */

/** An opaque compiled engine action (an NLR chainable). The plugin only passes these around. */
export interface EngineAction {
    readonly __engineAction: unique symbol;
}

/** A resolved stage character image — the only engine method the plugin needs. */
export interface StageImage {
    /** darkness 0 = normal, 1 = black. duration/easing come from config. */
    darken(darkness: number, durationMs: number, easing: string): EngineAction;
}

/**
 * A runtime boolean that lives in scene-local storage and is reset on scene entry. `write`
 * produces an action whose undo cleaner restores the previous value — Studio's responsibility,
 * because getting that cleaner wrong silently corrupts branch selection after an undo.
 */
export interface RuntimeFlag {
    /** A predicate evaluated at runtime, for use as a guard. */
    read(): () => boolean;
    /** An action that sets the flag, undoable. */
    write(value: boolean): EngineAction;
}

/** One block of a scene, in execution order, classified enough for the plugin to act on. */
export type CompileBlockView =
    /** A dialogue line. `speaker` is the character's stage object name, or null for narration. */
    | { kind: "dialogue"; id: string; speaker: string | null }
    /** A block contributed by THIS plugin (one of its story actions). */
    | { kind: "pluginAction"; id: string; actionId: string; params: Record<string, unknown> }
    /** Any other block (set background, wait, another plugin's block, …). */
    | { kind: "other"; id: string }
    /** A control-flow edge — branch enter/exit or a jump target — that breaks a run. */
    | { kind: "boundary"; id: string };

/** What the pass injects around a block: engine actions before and/or after it. */
export interface BlockInjection {
    before?: EngineAction[];
    after?: EngineAction[];
}

/** The per-scene context handed to a compile pass. */
export interface SceneCompileContext {
    /** Blocks in execution order. Control flow is flattened with `boundary` markers between edges. */
    readonly blocks: readonly CompileBlockView[];
    /** Every character stage object name that appears in this scene. */
    roster(): string[];
    /** Resolve a character stage object name to its Image, or null if it never enters. */
    resolveCharacterImage(objectName: string): StageImage | null;
    /** Fan actions out in parallel without blocking the line (allAsync — never doAsync). */
    parallel(actions: EngineAction[]): EngineAction;
    /** Wrap actions so they run only while `flag` reads true (Condition.If). */
    guarded(flag: RuntimeFlag, actions: EngineAction[]): EngineAction;
    /** A scene-local, undoable runtime flag, created/looked up by name. */
    runtimeFlag(name: string): RuntimeFlag;
    /** Attach injected actions to a block (by its id from `blocks`). */
    inject(blockId: string, injection: BlockInjection): void;
}

export interface StoryCompilePass {
    id: string;
    /** Called once per scene, before its blocks are compiled. */
    scene(ctx: SceneCompileContext): void;
}

/**
 * The `app.game` surface this plugin needs beyond the published `narraleaf-studio@0.2.0`.
 * `data` (the read side of `contributes.runtimeData`) exists in Studio's source but not yet in
 * the published package; `story` is the proposed compile-pass extension point. Both are cast to
 * from `app.game` in the runtime entry, localizing the dependency to a single line.
 */
export interface RequiredGameApi {
    story: {
        registerCompilePass(pass: StoryCompilePass): void;
    };
    data: {
        readJson<T = unknown>(namespace: string): T | null;
    };
}
