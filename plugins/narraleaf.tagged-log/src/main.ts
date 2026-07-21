/**
 * Studio entry: registers the node's editor metadata (palette + in-editor
 * preview execution).
 */

import { definePlugin } from "narraleaf-studio/plugin";
import { createTaggedLogNodes } from "./nodes";

export default definePlugin({
    setup(app) {
        app.services.blueprintNodes.registerMany(createTaggedLogNodes());
    },
});
