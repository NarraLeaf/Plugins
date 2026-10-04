/**
 * Runtime entry: registers the node execute bindings in every game execution
 * environment (Dev Mode window, Preview, Production, web export). Editor palette
 * metadata stays owned by the studio entry (main.tsx).
 *
 * The Steam bridge is started here only when the player has already unlocked
 * something, so an achievement earned while Steam was closed reaches Steam as soon
 * as the game starts with it. Otherwise it is spawned lazily on the first node that
 * needs it: a game that never touches an achievement never pays for a child
 * process, and a build for a platform with no bridge never notices.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { connectIfUnlocked } from "./bridge";
import { CATALOG_NAMESPACE, normalizeCatalog } from "./catalog";
import { createSteamAchievementNodes } from "./nodes";

export default defineRuntimePlugin({
    setup(app) {
        let warned = false;
        // Read lazily per execution so a Dev Mode session picks up catalog edits
        // on reload instead of caching a snapshot taken at setup time.
        const readCatalog = () => {
            const data = app.game.data.readJson(CATALOG_NAMESPACE);
            if (!data && !warned) {
                warned = true;
                // Not fatal: a project that never opened the editor has no
                // catalog, and every node degrades to an empty one.
                app.game.log("warning", "No achievement catalog was published with this game.");
            }
            return data;
        };
        app.game.blueprintNodes.registerMany(createSteamAchievementNodes(readCatalog));

        // Not awaited: setup must not hold the game's start for a child process.
        connectIfUnlocked(app.game, normalizeCatalog(readCatalog()).appId ?? null).catch((error: unknown) => {
            app.game.log("warning", `Steam sync at start failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    },
});
