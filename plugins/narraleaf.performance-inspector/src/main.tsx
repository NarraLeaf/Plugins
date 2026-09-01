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
import { formatChord, parseChord } from "./hotkey";
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

/**
 * The hotkey field, edited as text and committed on blur.
 *
 * Kept as a draft while it is being typed, because `Ctrl+Shift+F3` is invalid at every keystroke
 * until the last one, and a field that reverts to the stored value on the first unparsable character
 * cannot be edited at all.
 */
function HotkeyField({
    store,
    settings,
    disabled,
    title,
}: {
    store: SettingsStore;
    settings: InspectorSettings;
    disabled: boolean;
    title: string | undefined;
}) {
    const [draft, setDraft] = useState(settings.hotkey);
    const [touched, setTouched] = useState(false);
    useEffect(() => {
        setDraft(settings.hotkey);
        setTouched(false);
    }, [settings.hotkey]);

    const parsed = parseChord(draft);
    const commit = (): void => {
        if (!parsed) {
            setDraft(settings.hotkey);
            setTouched(false);
            return;
        }
        void store.update({ hotkey: formatChord(parsed) });
    };

    return (
        <div className="flex flex-col items-end gap-1">
            <ui.Input
                size="sm"
                value={draft}
                disabled={disabled}
                title={title}
                variant={touched && !parsed ? "error" : "default"}
                onChange={event => {
                    setDraft(event.target.value);
                    setTouched(true);
                }}
                onBlur={commit}
                onKeyDown={event => {
                    if (event.key === "Enter") {
                        event.currentTarget.blur();
                    }
                }}
            />
            {touched && !parsed ? (
                <span className="text-xs text-danger">
                    Write a key name, on its own or after Ctrl, Alt, Shift or Meta.
                </span>
            ) : null}
        </div>
    );
}

function PerformancePanel({ store }: { store: SettingsStore }) {
    const settings = useSettings(store);
    const freeze = ui.useFreezeGuard();
    const writes = freeze.writes();
    const chord = parseChord(settings.hotkey);
    const hotkey = chord ? formatChord(chord) : settings.hotkey;

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
                                ? "Previews and built games carry the overlay. Anyone who presses the hotkey can open it."
                                : "Only Dev Mode. Previews and built games ignore the hotkey."
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
                        label="Overlay hotkey"
                        description={`${hotkey} shows the compact display. Shift+${hotkey} opens the full panel.`}
                        control={
                            <HotkeyField
                                store={store}
                                settings={settings}
                                disabled={writes.disabled}
                                title={writes.title}
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
                                title={writes.title}
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
                                title={writes.title}
                                onCheckedChange={checked => void store.update({ logOnCapture: checked })}
                            />
                        }
                    />
                </ui.Panel.Section>

                <ui.Panel.Section title="In the game">
                    <ui.Panel.Row
                        label="Reports"
                        description="The full panel copies a report as JSON or as a written summary, and keeps the last capture in plugin storage."
                    />
                    <ui.Panel.Row
                        label="Blueprint nodes"
                        description="Set Performance Overlay, Mark Performance Event, Begin and End Performance Span, Get Performance Stats, Capture Performance Report and Reset Performance Session, under the Performance category."
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
