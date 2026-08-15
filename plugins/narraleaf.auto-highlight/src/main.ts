/**
 * Studio entry — runs in the editor process.
 *
 * Registers the five story actions that author AutoHighlight. Each one inserts a `{action:"plugin"}`
 * marker row; the runtime entry's compile pass is what reads those rows back and emits the darkens.
 * The plugin holds no editor state of its own, so `setup` returns no cleanup - unregistering the
 * actions is the host's job, through the disposers `register` hands back.
 *
 * On the one action that takes an argument: `Highlight Characters` reads its cast from what the
 * author typed after the command, because that is the only channel a story action has. A
 * registration declares an id, a label and a `createBlock`, and `createBlock` receives the trailing
 * text - so `/…highlight Alice Bob` is authorable today, while a picker for it is not (there is no
 * inspector for a plugin row to draw one in). The names are stored verbatim and matched against the
 * scene's roster at compile time; a name that matches nothing is simply not lit, which is the same
 * thing that happens to a character who never enters.
 */

import { definePlugin, type StoryBlock } from "narraleaf-studio/plugin";
import { ACTION_IDS, PLUGIN_ID, parseCharacterList } from "./actions";
import type { StoryPluginActionPayload } from "./contract";

/**
 * Build one marker row.
 *
 * The payload cast is the same dependency the runtime entry has, from the same cause: the published
 * `narraleaf-studio` types are 0.5.0, whose `StoryActionPayload` predates the `plugin` arm. See
 * `contract.ts` for what removes it.
 */
function markerBlock(id: string, actionId: string, params: Record<string, unknown> = {}): StoryBlock {
    const payload: StoryPluginActionPayload = { action: "plugin", pluginId: PLUGIN_ID, actionId, params };
    return {
        id,
        kind: "action",
        parentId: null,
        childrenIds: [],
        payload,
    } as unknown as StoryBlock;
}

export default definePlugin({
    setup(app) {
        app.services.story.actions.registerMany([
            {
                id: ACTION_IDS.enable,
                label: "Enable Auto-Highlight",
                detail: "From here on, the speaker is lit and everyone else is dimmed.",
                createBlock: input => markerBlock(input.generateId(), ACTION_IDS.enable),
            },
            {
                id: ACTION_IDS.disable,
                label: "Disable Auto-Highlight",
                detail: "Stop auto-highlighting and restore everyone.",
                createBlock: input => markerBlock(input.generateId(), ACTION_IDS.disable),
            },
            {
                id: ACTION_IDS.highlight,
                label: "Highlight Characters",
                detail: "Light the characters you name, dim the rest. A one-off override.",
                createBlock: input => markerBlock(input.generateId(), ACTION_IDS.highlight, {
                    characters: parseCharacterList(input.initialText),
                }),
            },
            {
                id: ACTION_IDS.highlightAll,
                label: "Highlight All",
                detail: "Restore everyone to full brightness.",
                createBlock: input => markerBlock(input.generateId(), ACTION_IDS.highlightAll),
            },
            {
                id: ACTION_IDS.darkenAll,
                label: "Darken All",
                detail: "Dim everyone.",
                createBlock: input => markerBlock(input.generateId(), ACTION_IDS.darkenAll),
            },
        ]);
    },
});
