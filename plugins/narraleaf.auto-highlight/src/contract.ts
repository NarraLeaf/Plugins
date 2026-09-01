/**
 * The slice of Studio's API this plugin needs that the published `narraleaf-studio` package does not
 * carry yet.
 *
 * **This file is a mirror, not a design.** Every declaration below is copied from Studio's own
 * source - `src/renderer/lib/ui-editor/runtime/game/storyCompilePass.ts` and the `plugin` arm of
 * `StoryActionPayload` in `src/shared/types/story/document.ts`, as of Studio 0.6.0 - and exists here
 * only because the types package published to npm is 0.5.0, which predates them. That distinction
 * matters: the previous version of this file was the opposite, a specification of an API Studio had
 * not agreed to, and both halves drifted until neither described anything real.
 *
 * **Delete this file when `narraleaf-studio@0.6.0` (or later) is published.** The replacement is a
 * plain import - every name below is exported from `narraleaf-studio/runtime` - and the only other
 * change is dropping the two casts in `runtime.ts` and `main.ts`.
 */

/** An opaque compiled engine action. The plugin only passes these around. */
export type EngineAction = { readonly __nlsEngineAction: unique symbol };

/** A character's stage image, narrowed to the one thing a pass can ask of it. */
export interface StageImage {
    /** 0 is untouched, 1 is black. */
    darken(darkness: number, durationMs: number, easing: string): EngineAction;
}

/**
 * A boolean in the scene's own local storage, reset when the scene is entered. Write-only by
 * design: the read half is {@link SceneCompileContext.guarded}, because a pass runs at compile time
 * and the value only exists while the game plays.
 */
export interface RuntimeFlag {
    /** An action that sets the flag. Undoable: the compiler attaches the cleaner. */
    write(value: boolean): EngineAction;
}

/** One row of a scene, in execution order, classified down to what a pass can act on. */
export type CompileBlockView =
    | { kind: "dialogue"; id: string; speaker: string | null }
    | { kind: "pluginAction"; id: string; pluginId: string; actionId: string; params: Record<string, unknown> }
    | { kind: "other"; id: string }
    | { kind: "boundary"; id: string };

/** What a pass attaches around one row. */
export interface BlockInjection {
    before?: EngineAction[];
    after?: EngineAction[];
}

/** The per-scene context handed to a compile pass. */
export interface SceneCompileContext {
    readonly blocks: readonly CompileBlockView[];
    roster(): string[];
    resolveCharacterImage(objectName: string): StageImage | null;
    parallel(actions: EngineAction[]): EngineAction;
    guarded(flag: RuntimeFlag, actions: EngineAction[]): EngineAction;
    runtimeFlag(name: string): RuntimeFlag;
    inject(blockId: string, injection: BlockInjection): void;
}

export interface StoryCompilePass {
    id: string;
    scene(ctx: SceneCompileContext): void;
}

/** The `app.game.story` namespace, present with the `story.compile` runtime capability. */
export interface RuntimePluginStory {
    registerCompilePass(pass: StoryCompilePass): void;
}

/** The payload of the `{action:"plugin"}` marker row this plugin's story actions insert. */
export interface StoryPluginActionPayload {
    action: "plugin";
    pluginId: string;
    actionId: string;
    params: Record<string, unknown>;
}
