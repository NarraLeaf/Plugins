/**
 * The Studio *authoring* surface this plugin needs, alongside the runtime one in contract.ts.
 *
 * ⚠️ Also not yet in the published `narraleaf-studio` package. This is the declarative story-
 * action registration from plan §4.2: a plugin declares its actions and their parameter schema,
 * and Studio renders the inline editor and produces the `{action:"plugin"}` blocks. Declared as
 * types so main.ts reads as the intended API; a cast localizes the dependency.
 */

/** A single authored parameter of a story action, rendered by Studio's inline editor. */
export type StoryActionParam =
    | { key: string; label: string; kind: "characterMultiSelect" }
    | { key: string; label: string; kind: "number"; min?: number; max?: number; step?: number }
    | { key: string; label: string; kind: "boolean" }
    | { key: string; label: string; kind: "text" };

export interface StoryActionRegistration {
    /** Full id, namespaced by plugin id (see ACTION_IDS). */
    id: string;
    /** Palette label, e.g. "Enable Auto-Highlight". */
    label: string;
    /** Optional one-line description shown in the palette. */
    detail?: string;
    /** Parameters authored on the block; omitted or empty for a pure marker. */
    params?: StoryActionParam[];
}

export interface StudioStoryApi {
    actions: {
        /** Register a palette command that inserts a `{action:"plugin"}` block for this plugin. */
        register(registration: StoryActionRegistration): { cancel(): void };
    };
}

/** The `app.services` extension this plugin needs on the studio entry. */
export interface StudioServicesWithStory {
    story: StudioStoryApi;
}
