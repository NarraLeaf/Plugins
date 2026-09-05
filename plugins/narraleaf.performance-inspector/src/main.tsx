/**
 * Studio entry: the panel where the author decides what the profiler does, and the palette entries
 * for its blueprint nodes.
 *
 * A sidebar panel rather than an editor tab. There is nothing to author here - no table, no list -
 * only a handful of settings and the key that opens the overlay, and the right rail is where a
 * short settings surface belongs.
 *
 * The settings are written to this plugin's own store and published with the game through
 * `contributes.runtimeData`, which is how the runtime entry reads them. Nothing here measures
 * anything: the profiler only exists inside a running game.
 */

import { useEffect, useState } from "react";
import { Gauge } from "lucide-react";
import { PanelPosition, definePlugin, ui, type PluginApp } from "narraleaf-studio/plugin";
import { createPerformanceNodes, inertBridge } from "./nodes";
import {
    DEFAULT_SETTINGS,
    HISTORY_SECONDS_CHOICES,
    PLUGIN_ID,
    SETTINGS_NAMESPACE,
    SETTINGS_VERSION,
    normalizeSettings,
    type InspectorSettings,
} from "./settings";

const PANEL_ID = `${PLUGIN_ID}.panel`;

type SettingsStore = ReturnType<typeof createSettingsStore>;

function createSettingsStore(app: PluginApp) {
    let settings: InspectorSettings = { ...DEFAULT_SETTINGS };
    const listeners = new Set<() => void>();

    const notify = (): void => {
        for (const listener of listeners) {
            listener();
        }
    };

    return {
        /**
         * Read the settings off disk. Also the reloader: version control replaces the working tree
         * underneath a panel, and a store that kept its pre-restore copy in memory would write it
         * back over the version the author just restored.
         */
        async load(): Promise<void> {
            settings = normalizeSettings(await app.services.storage.readJson(SETTINGS_NAMESPACE));
            notify();
        },
        get: (): InspectorSettings => settings,
        subscribe(listener: () => void): () => void {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async update(patch: Partial<InspectorSettings>): Promise<void> {
            // Bail before touching memory, not after: a frozen project discards the write at the
            // boundary, so mutating first would leave the panel showing a setting the disk does not
            // have - and the next thaw would write that phantom over the restored version.
            if (app.services.workspace.frozen) {
                return;
            }
            settings = normalizeSettings({ ...settings, ...patch });
            notify();
            await app.services.storage.writeJson(SETTINGS_NAMESPACE, {
                ...settings,
                version: SETTINGS_VERSION,
            });
        },
    };
}

function useSettings(store: SettingsStore): InspectorSettings {
    const [settings, setSettings] = useState<InspectorSettings>(() => store.get());
    useEffect(() => store.subscribe(() => setSettings(store.get())), [store]);
    return settings;
}

function PerformancePanel({ store }: { store: SettingsStore }) {
    const settings = useSettings(store);
    const freeze = ui.useFreezeGuard();
    const writes = freeze.writes();

    return (
        <ui.Panel.Root>
            <ui.Panel.Header
                title="Performance Inspector"
                description="Frame rate, memory and asset loading, measured inside the running game."
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <ui.Panel.Section title="Availability">
                    <ui.Panel.Row
                        label="Overlay availability"
                        description={
                            settings.availability === "everywhere"
                                ? "Previews and built games can open the overlay. Whatever opens it in Dev Mode opens it for a player too."
                                : "Only Dev Mode. In a preview or a built game the nodes do nothing."
                        }
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.availability}
                                disabled={writes.disabled}
                                options={[
                                    { value: "studio", label: "Dev Mode only" },
                                    { value: "everywhere", label: "Dev Mode and every build" },
                                ]}
                                onChange={value => void store.update({ availability: value === "everywhere" ? "everywhere" : "studio" })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label="Start measuring"
                        description={
                            settings.collectFrom === "graph"
                                ? "Nothing is measured until a Start Profiling node runs, so the boot is not covered."
                                : "From the first frame, so startup is covered."
                        }
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.collectFrom}
                                disabled={writes.disabled}
                                options={[
                                    { value: "gameStart", label: "At game start" },
                                    { value: "graph", label: "When a graph says so" },
                                ]}
                                onChange={value => void store.update({ collectFrom: value === "graph" ? "graph" : "gameStart" })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label="Overlay at game start"
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.openAt}
                                disabled={writes.disabled}
                                options={[
                                    { value: "hidden", label: "Nothing" },
                                    { value: "hud", label: "Compact display" },
                                    { value: "inspector", label: "Full panel" },
                                ]}
                                onChange={value => void store.update({ openAt: String(value) as InspectorSettings["openAt"] })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label="Compact display corner"
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.corner}
                                disabled={writes.disabled}
                                options={[
                                    { value: "top-left", label: "Top left" },
                                    { value: "top-right", label: "Top right" },
                                    { value: "bottom-left", label: "Bottom left" },
                                    { value: "bottom-right", label: "Bottom right" },
                                ]}
                                onChange={value => void store.update({ corner: String(value) as InspectorSettings["corner"] })}
                            />
                        }
                    />
                </ui.Panel.Section>

                <ui.Panel.Section title="Collection">
                    <ui.Panel.Row
                        label="Measure asset loading"
                        description="Asset sizes, request counts, decode time, and what is still held in memory."
                        control={
                            <ui.Switch
                                checked={settings.instrumentAssets}
                                disabled={writes.disabled}
                                data-tip={writes["data-tip"]}
                                onCheckedChange={checked => void store.update({ instrumentAssets: checked })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label="Frame history"
                        description="How far back the frame-time chart and the percentiles reach."
                        control={
                            <ui.Select
                                size="sm"
                                value={String(settings.historySeconds)}
                                disabled={writes.disabled}
                                options={HISTORY_SECONDS_CHOICES.map(seconds => ({
                                    value: String(seconds),
                                    label: seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`,
                                }))}
                                onChange={value => void store.update({ historySeconds: Number(value) })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label="Reports in the game log"
                        description="A capture also lands in the log file the build writes, so it survives the run."
                        control={
                            <ui.Switch
                                checked={settings.logOnCapture}
                                disabled={writes.disabled}
                                data-tip={writes["data-tip"]}
                                onCheckedChange={checked => void store.update({ logOnCapture: checked })}
                            />
                        }
                    />
                </ui.Panel.Section>

                <ui.Panel.Section title="In the game">
                    <ui.Panel.Row
                        label="Opening the overlay"
                        description="A Set Performance Overlay node. For a key, put an On Key Down head in the game's global blueprint and wire it to that node — the binding is yours, and this plugin takes no key of its own."
                    />
                    <ui.Panel.Row
                        label="Blueprint nodes"
                        description="Start and Stop Profiling, Set Performance Overlay, Mark Performance Event, Begin and End Performance Span, Get Performance Stats, and Capture Performance Report, under the Performance category."
                    />
                    <ui.Panel.Row
                        label="Reports"
                        description="The full panel copies a report as JSON or as a written summary, and keeps the last capture in plugin storage."
                    />
                </ui.Panel.Section>
            </div>
        </ui.Panel.Root>
    );
}

export default definePlugin({
    async setup(app) {
        const store = createSettingsStore(app);
        await store.load();

        // The editor registers the same definitions the game does, for their palette entries and
        // inspector shape. Nothing profiles anything here, so they run against the inert bridge.
        app.services.blueprintNodes.registerMany(createPerformanceNodes(inertBridge));

        const unregisterReloader = app.services.workspace.registerReloader(() => store.load());
        const unregisterPanel = app.services.ui.panels.register({
            id: PANEL_ID,
            title: "Performance",
            icon: <Gauge size={16} />,
            position: PanelPosition.Right,
            component: () => <PerformancePanel store={store} />,
            order: 680,
        });

        return () => {
            unregisterPanel();
            unregisterReloader();
        };
    },
});
