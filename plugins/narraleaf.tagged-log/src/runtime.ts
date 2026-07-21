/**
 * Runtime entry: registers the node's execute binding for game execution
 * environments (Dev Mode, Preview, Production). Same definitions as the studio
 * entry, from one shared module.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { createTaggedLogNodes } from "./nodes";

export default defineRuntimePlugin({
    setup(app) {
        app.game.blueprintNodes.registerMany(createTaggedLogNodes());
    },
});
