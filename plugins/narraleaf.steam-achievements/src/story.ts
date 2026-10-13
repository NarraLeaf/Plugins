/**
 * The Unlock Steam Achievement story row, shared by both plugin entries:
 * - main.tsx registers the editor half through `app.services.story.actions`: the palette entry, the
 *   text the row reads as, and the achievement pick the scene inspector shows on it;
 * - runtime.ts registers the game half through `app.game.storyActions`, under the same id.
 *
 * The row is a story beat's way to unlock: "the player has seen this ending" belongs on the line
 * where it happens, not in a blueprint the author has to wire to it. It writes the same mirror the
 * Unlock Achievement node does, so a row and a node naming the same achievement agree everywhere.
 *
 * The achievement pick is the node's own inspector param, so the row and the node list the same
 * achievements, from the same option source, in the same words.
 */

import type { StoryBlock, StoryPluginActionRegistration } from "narraleaf-studio/plugin";
import type { RuntimeStoryActionDef } from "narraleaf-studio/runtime";
import { PLUGIN_ID, normalizeCatalog, resolveAchievementName } from "./catalog";
import { echo, recordUnlocked } from "./bridge";
import { PARAM_ACHIEVEMENT, achievementParam, readString, type CatalogReader } from "./nodes";
import type { Translate } from "./i18n";

/**
 * Not `${PLUGIN_ID}.unlock`, the Unlock Achievement node's type: the two live in different
 * registries, but a row and a node sharing one name would read as the same thing in a project file.
 */
export const UNLOCK_STORY_ACTION_ID = `${PLUGIN_ID}.story.unlock`;

/** The editor half: what the palette offers, what a row reads as, and what its inspector edits. */
export function createUnlockStoryAction(readCatalog: CatalogReader, t: Translate): StoryPluginActionRegistration {
    return {
        id: UNLOCK_STORY_ACTION_ID,
        label: t("story.unlock.label"),
        detail: t("story.unlock.detail"),
        // English, like a built-in command's own word: `/unlock ACH_WIN` works whatever language the
        // label is in.
        keywords: ["unlock", "achievement"],
        params: [achievementParam(t)],
        // `/unlock ACH_WIN` arrives with "ACH_WIN" as the initial text; a row picked from the
        // palette arrives with none and is given its achievement in the inspector.
        createBlock: ({ generateId, initialText }): StoryBlock => {
            const achievementId = resolveAchievementName(normalizeCatalog(readCatalog()), initialText);
            return {
                id: generateId(),
                kind: "action",
                parentId: null,
                childrenIds: [],
                payload: {
                    action: "plugin",
                    pluginId: PLUGIN_ID,
                    actionId: UNLOCK_STORY_ACTION_ID,
                    params: achievementId ? { [PARAM_ACHIEVEMENT]: achievementId } : {},
                },
            };
        },
        describe: params => t("story.unlock.row", {
            id: readString(params[PARAM_ACHIEVEMENT]) || t("story.unlock.unassigned"),
        }),
    };
}

/** The game half: what runs when the story reaches one of these rows. */
export function createSteamStoryActions(readCatalog: CatalogReader): RuntimeStoryActionDef[] {
    return [
        {
            id: UNLOCK_STORY_ACTION_ID,
            run: async ({ params, game }) => {
                const id = readString(params[PARAM_ACHIEVEMENT]);
                if (!id) {
                    game.log("warning", "An Unlock Steam Achievement row has no achievement picked; nothing was unlocked.");
                    return;
                }
                await recordUnlocked(game, id);
                // Not awaited, unlike the node. The story waits on this row, and the first unlock of
                // a session is the call that starts the Steam bridge - a pause the player would feel
                // between two lines. The mirror write above already decided the unlock, and the next
                // connection replays it if this echo never lands.
                void echo(game, normalizeCatalog(readCatalog()).appId ?? null, "achievements.unlock", { id });
            },
        },
    ];
}
