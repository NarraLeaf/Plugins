/**
 * The project-scoped half of the settings, over `app.services.storage`.
 *
 * Two obligations come with writing project data, and both are met here rather
 * than in the panel:
 *
 *  - **Bail before touching memory when the project is frozen.** A frozen
 *    project discards writes at the boundary and reports success, so a store
 *    that mutated first and wrote second would keep a copy the disk does not
 *    have — and hand it back over the restored version on the next edit.
 *  - **Re-read when Studio replaces the working tree.** `registerReloader` runs
 *    after a restore or a thaw with the new bytes already at the read boundary.
 */

import type { PluginApp } from "narraleaf-studio/plugin";
import {
    DEFAULT_PROJECT_SETTINGS,
    SETTINGS_NAMESPACE,
    normalizeProjectSettings,
    type ProjectSettings,
} from "./settings";

export type ProjectStore = {
    get(): ProjectSettings;
    subscribe(listener: () => void): () => void;
    /** Reads storage into memory. Also the reloader. */
    load(): Promise<void>;
    /** No-ops while frozen; resolves to whether the write actually happened. */
    patch(patch: Partial<ProjectSettings>): Promise<boolean>;
};

export function createProjectStore(app: PluginApp): ProjectStore {
    let settings: ProjectSettings = DEFAULT_PROJECT_SETTINGS;
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) {
            listener();
        }
    };

    return {
        get: () => settings,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async load() {
            settings = normalizeProjectSettings(await app.services.storage.readJson(SETTINGS_NAMESPACE));
            notify();
        },
        async patch(patch) {
            if (app.services.workspace.frozen) {
                return false;
            }
            const next = normalizeProjectSettings({ ...settings, ...patch });
            settings = next;
            notify();
            await app.services.storage.writeJson(SETTINGS_NAMESPACE, next);
            return true;
        },
    };
}
