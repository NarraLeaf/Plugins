/**
 * Runtime entry — runs inside the game (Dev Mode, Preview, Production).
 *
 * All it does is read the baked project config and register one compile pass; every darken it ever
 * emits comes out of the planner via the adapter. There is no per-frame work and no runtime stage
 * inspection — the highlighting is decided entirely while the story compiles.
 *
 * `app.game.story` is present because the manifest declares the `story.compile` runtime capability;
 * an undeclared domain is absent from `app.game` rather than throwing, so the check below is the
 * honest test and not defensive noise. The cast to {@link RuntimePluginStory} is the published-types
 * gap described in `contract.ts`, and nothing else.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { applyToScene } from "./adapter";
import { CONFIG_NAMESPACE, normalizeConfig } from "./config";
import { PLUGIN_ID } from "./actions";
import type { RuntimePluginStory } from "./contract";

export default defineRuntimePlugin({
    setup(app) {
        const story = (app.game as { story?: RuntimePluginStory }).story;
        if (!story) {
            // Reached only if the manifest and this file disagree about the capability. Say so once
            // and do nothing: a game that plays without the highlighting is the right failure, and a
            // throw here would take the whole plugin - and any other entry point it grows - with it.
            app.game.log("error", "Auto-Highlight needs the story.compile capability; nothing will be highlighted.");
            return;
        }

        const config = normalizeConfig(app.game.data.readJson(CONFIG_NAMESPACE));
        story.registerCompilePass({
            id: PLUGIN_ID,
            scene: ctx => applyToScene(ctx, config),
        });
    },
});
