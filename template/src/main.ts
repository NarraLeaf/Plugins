/**
 * Studio entry — runs in the editor process.
 *
 * Loaded when the workspace opens, and unloaded when the plugin is disabled or
 * uninstalled. Anything setup() registers through `app.services` is tracked by
 * the host and reclaimed automatically on unload; returning a cleanup function
 * is only needed for resources the host does not own (timers, listeners you
 * attached yourself, open handles).
 */

import { definePlugin } from "narraleaf-studio/plugin";
import { createStarterNodes } from "./nodes";

export default definePlugin({
    setup(app) {
        app.services.blueprintNodes.registerMany(createStarterNodes());

        app.services.ui.notifications.info(`${app.manifest.name} loaded`);
    },
});
