/**
 * Three settings, in two places, because they are not the same kind of thing and
 * Studio only offers a home for one of them.
 *
 * **The API key is not project data.** `app.services.storage` writes into
 * `editor/services/`, which is inside the project's versioned working tree — the
 * same tree the author commits and shares. A credential written there is a
 * credential in the repository, and on a public repository that is a leak with
 * no undo. So the key, and the on/off switch that goes with it, live in the
 * workspace window's `localStorage`: machine-scoped, outside the project, never
 * committed. It is plaintext, which is exactly what `~/.wakatime.cfg` is; Studio
 * exposes no secret store, and the alternative here is not "encrypted" but "in
 * git".
 *
 * **The project name is project data**, and belongs in project storage on
 * purpose: everyone working on the same project should report to the same
 * WakaTime project, and the way to make that true is to version the answer
 * alongside the story rather than ask each collaborator to retype it.
 */

import { trimQueue, userAgent, type Credentials, type Heartbeat } from "./wakatime";

export const PLUGIN_ID = "wangzixu.wakatime-plugin";

/** Project storage namespace. Prefixed with the plugin id, like every other contributed name. */
export const SETTINGS_NAMESPACE = `${PLUGIN_ID}.settings`;

const MACHINE_KEY = `${PLUGIN_ID}.account`;
const QUEUE_KEY = `${PLUGIN_ID}.queue`;

/** What the heartbeats say they are about. See the note on `Heartbeat`. */
export const ENTITY = "NarraLeaf Studio";

/* ------------------------------------------------- machine-scoped settings */

export type MachineSettings = {
    apiKey: string;
    enabled: boolean;
};

/**
 * Load-time only. Cleaning a value on the way *in* is safe; doing it on the way
 * out of an edit is not — a debounced commit that trimmed would rewrite the text
 * under the cursor. So editing stores the string verbatim and
 * {@link toCredentials} trims at the point of use.
 */
export function normalizeMachineSettings(raw: unknown): MachineSettings {
    const record = isRecord(raw) ? raw : {};
    return {
        apiKey: typeof record.apiKey === "string" ? record.apiKey.trim() : "",
        // Defaults to on, which is safe precisely because it is inert: no key,
        // no project name, nothing sent.
        enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    };
}

export function toCredentials(apiKey: string, pluginVersion: string): Credentials {
    return { apiKey: apiKey.trim(), userAgent: userAgent(pluginVersion) };
}

/* --------------------------------------------------- project-scoped setting */

export type ProjectSettings = {
    version: 1;
    /** Empty means "not named yet"; nothing is sent until it has one. */
    projectName: string;
};

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = { version: 1, projectName: "" };

export function normalizeProjectSettings(raw: unknown): ProjectSettings {
    const record = isRecord(raw) ? raw : {};
    return {
        version: 1,
        // Verbatim, for the reason on normalizeMachineSettings. `buildHeartbeat`
        // trims what it actually sends.
        projectName: typeof record.projectName === "string" ? record.projectName : "",
    };
}

/* ------------------------------------------------------------ local storage */

/**
 * `localStorage` can throw outright (a partitioned or disabled store), and a
 * time tracker is not worth taking the workspace down for. Every access here
 * fails to a default instead.
 */
function readLocal(key: string): unknown {
    try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
    } catch {
        return null;
    }
}

function writeLocal(key: string, value: unknown): void {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* Quota or a disabled store. The in-memory copy still works this session. */
    }
}

/* -------------------------------------------------------------------- store */

export type MachineStore = {
    get(): MachineSettings;
    subscribe(listener: () => void): () => void;
    set(patch: Partial<MachineSettings>): void;
};

export function createMachineStore(onChange?: () => void): MachineStore {
    let settings = normalizeMachineSettings(readLocal(MACHINE_KEY));
    const listeners = new Set<() => void>();

    return {
        get: () => settings,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        set(patch) {
            // Verbatim. Cleaning happens on load and at `toCredentials`.
            settings = { ...settings, ...patch };
            writeLocal(MACHINE_KEY, settings);
            for (const listener of listeners) {
                listener();
            }
            // A changed key is the one event that makes a paused-on-auth-failure
            // tracker worth waking: the reason it stopped may no longer hold.
            onChange?.();
        },
    };
}

/* ---------------------------------------------------------- heartbeat queue */

export function readQueue(): Heartbeat[] {
    const raw = readLocal(QUEUE_KEY);
    if (!Array.isArray(raw)) {
        return [];
    }
    return trimQueue(raw.filter(isHeartbeat));
}

export function writeQueue(queue: readonly Heartbeat[]): void {
    writeLocal(QUEUE_KEY, trimQueue(queue));
}

function isHeartbeat(value: unknown): value is Heartbeat {
    return isRecord(value)
        && typeof value.entity === "string"
        && typeof value.time === "number"
        && Number.isFinite(value.time);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
