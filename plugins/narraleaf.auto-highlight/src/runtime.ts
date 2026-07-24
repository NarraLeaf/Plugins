/**
 * Runtime entry — runs inside the game (Dev Mode, Preview, Production).
 *
 * All it does is read the baked project config and register one compile pass; every darken it
 * ever emits comes out of the planner via the adapter. There is no per-frame work and no
 * runtime stage inspection — the highlighting is decided entirely at compile time.
 *
 * ⚠️ `app.game.story.registerCompilePass` (the compile-pass extension point) and `app.game.data`
 * (the read side of `contributes.runtimeData`) are not yet in the published `narraleaf-studio`.
 * The single cast to {@link RequiredGameApi} localizes both; when Studio ships them this file
 * needs no other change.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { applyToScene } from "./adapter";
import { CONFIG_NAMESPACE, normalizeConfig } from "./config";
import type { RequiredGameApi } from "./contract";

export default defineRuntimePlugin({
    setup(app) {
        const game = app.game as unknown as RequiredGameApi;
        const config = normalizeConfig(game.data.readJson(CONFIG_NAMESPACE));

        game.story.registerCompilePass({
            id: "narraleaf.auto-highlight",
            scene(ctx) {
                applyToScene(ctx, config);
            },
        });
    },
});
