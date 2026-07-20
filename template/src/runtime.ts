/**
 * Runtime entry — runs inside the game (Dev Mode window, Preview, Production).
 *
 * This is game code: no Studio services, no privileged facade, no unload
 * lifecycle. It exists so a node that appears in the editor palette also
 * executes in a shipped build. A plugin that only adds editor tooling can drop
 * this file and the `runtime` key from manifest.json.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { createStarterNodes } from "./nodes";

export default defineRuntimePlugin({
    setup(app) {
        app.game.blueprintNodes.registerMany(createStarterNodes());
    },
});
