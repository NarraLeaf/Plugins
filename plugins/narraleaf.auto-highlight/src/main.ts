/**
 * Studio entry — runs in the editor process.
 *
 * Registers the five story actions that author AutoHighlight. Each inserts a `{action:"plugin"}`
 * block; the runtime entry's compile pass is what reads those blocks and emits the darkens. The
 * plugin holds no editor state of its own, so no cleanup is returned.
 *
 * ⚠️ `app.services.story.actions` is the authoring API specified in studio-contract.ts and not
 * yet shipped by Studio; the cast localizes that dependency (see runtime.ts for the twin note).
 *
 * TODO(config-panel): a self-drawn settings panel (via `app.services.ui.panels`) writing the
 * `config` runtime-data namespace — amount / duration / easing / narrationBreaksRun / exclude.
 * Until then the defaults in config.ts apply, and the compile pass already reads whatever the
 * namespace holds, so the panel can land independently.
 */

import { definePlugin } from "narraleaf-studio/plugin";
import { ACTION_IDS } from "./actions";
import type { StudioServicesWithStory } from "./studio-contract";

export default definePlugin({
    setup(app) {
        const story = (app.services as unknown as StudioServicesWithStory).story;

        story.actions.register({
            id: ACTION_IDS.enable,
            label: "Enable Auto-Highlight",
            detail: "From here on, the speaker is lit and everyone else is dimmed.",
        });
        story.actions.register({
            id: ACTION_IDS.disable,
            label: "Disable Auto-Highlight",
            detail: "Stop auto-highlighting and restore everyone.",
        });
        story.actions.register({
            id: ACTION_IDS.highlight,
            label: "Highlight Characters",
            detail: "Light the chosen characters, dim the rest (a one-off override).",
            params: [{ key: "characters", label: "Characters", kind: "characterMultiSelect" }],
        });
        story.actions.register({
            id: ACTION_IDS.highlightAll,
            label: "Highlight All",
            detail: "Restore everyone to full brightness.",
        });
        story.actions.register({
            id: ACTION_IDS.darkenAll,
            label: "Darken All",
            detail: "Dim everyone.",
        });

        app.services.ui.notifications.info(`${app.manifest.name} loaded`);
    },
});
