/**
 * The plugin's state in memory, backed by project storage. One instance per workspace: the panel
 * subscribes to it, the agent tools and the test read and write through it.
 *
 * Disk first, memory second: a write that throws (or that the freeze would drop) leaves memory as
 * the disk has it. The freeze is checked before anything is written, because `writeJson` on a frozen
 * project returns normally without writing.
 */

import type { PluginServices } from "narraleaf-studio/plugin";
import { NS, type NamespaceKey } from "./ids";
import { emptyState, type BridgeState } from "./types";

export class FrozenError extends Error {
    constructor(reason: string | null) {
        super(`The project is read-only right now${reason ? ` (${reason})` : ""}; nothing was written.`);
    }
}

type Listener = () => void;

export class BridgeStore {
    private state: BridgeState = emptyState();
    private loaded = false;
    private readonly listeners = new Set<Listener>();

    constructor(
        private readonly storage: PluginServices["storage"],
        private readonly workspace: PluginServices["workspace"],
    ) {}

    get snapshot(): BridgeState {
        return this.state;
    }

    get isLoaded(): boolean {
        return this.loaded;
    }

    get frozen(): boolean {
        return this.workspace.frozen;
    }

    subscribe = (listener: Listener): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    getSnapshot = (): BridgeState => this.state;

    private emit(): void {
        for (const listener of this.listeners) listener();
    }

    /**
     * Read every namespace. Used at setup and as the workspace reloader (undo of an agent write,
     * a version-control restore). Reads everything before replacing anything, so a failure keeps
     * the previous state whole.
     */
    async load(): Promise<void> {
        const keys = Object.keys(NS) as NamespaceKey[];
        const values = await Promise.all(keys.map(key => this.storage.readJson<Record<string, unknown>>(NS[key])));
        const next = emptyState();
        keys.forEach((key, index) => {
            const value = values[index];
            if (value && value.version === 1) {
                (next as Record<NamespaceKey, unknown>)[key] = value;
            }
        });
        this.state = next;
        this.loaded = true;
        this.emit();
    }

    /** Write several namespaces. Within an agent's write tool they become one undo step. */
    async write(patch: Partial<BridgeState>): Promise<void> {
        if (this.workspace.frozen) throw new FrozenError(this.workspace.freezeReason);
        const keys = Object.keys(patch) as NamespaceKey[];
        for (const key of keys) {
            const value = patch[key];
            if (value) await this.storage.writeJson(NS[key], value as Record<string, unknown>);
        }
        this.state = { ...this.state, ...patch };
        this.emit();
    }
}
