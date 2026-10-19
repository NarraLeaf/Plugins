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

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Gauge } from "lucide-react";
import { PanelPosition, definePlugin, ui, type PluginApp } from "narraleaf-studio/plugin";
import { EDITOR_MESSAGES, type EditorTranslate } from "./editorStrings";
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
 * The plugin's translator, re-rendering the panel on a language switch.
 *
 * The returned function changes identity with the locale, so everything the panel words is worded
 * again in the new language.
 */
function useTranslate(app: PluginApp): EditorTranslate {
    const translator = useMemo(() => app.services.i18n.createTranslator(EDITOR_MESSAGES), [app]);
    const subscribe = useCallback((listener: () => void) => {
        const cleanup = app.services.i18n.onLocaleChange(() => listener());
        return () => {
            void cleanup();
        };
    }, [app]);
    const locale = useSyncExternalStore(subscribe, () => app.services.i18n.locale);
    // `locale` is in the deps for the new identity, not for its value: the translator resolves
    // against the editor language at call time.
    return useCallback((key, params) => translator.t(key, params), [translator, locale]);
}

function PerformancePanel({ app, store }: { app: PluginApp; store: SettingsStore }) {
    const settings = useSettings(store);
    const t = useTranslate(app);
    const freeze = ui.useFreezeGuard();
    const writes = freeze.writes();

    return (
        <ui.Panel.Root>
            <ui.Panel.Header
                title={t("header.title")}
                description={t("header.description")}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <ui.Panel.Section title={t("section.availability")}>
                    <ui.Panel.Row
                        label={t("availability.label")}
                        description={
                            settings.availability === "everywhere"
                                ? t("availability.everywhere.description")
                                : t("availability.studio.description")
                        }
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.availability}
                                disabled={writes.disabled}
                                options={[
                                    { value: "studio", label: t("availability.option.studio") },
                                    { value: "everywhere", label: t("availability.option.everywhere") },
                                ]}
                                onChange={value => void store.update({ availability: value === "everywhere" ? "everywhere" : "studio" })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label={t("collectFrom.label")}
                        description={
                            settings.collectFrom === "graph"
                                ? t("collectFrom.graph.description")
                                : t("collectFrom.gameStart.description")
                        }
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.collectFrom}
                                disabled={writes.disabled}
                                options={[
                                    { value: "gameStart", label: t("collectFrom.option.gameStart") },
                                    { value: "graph", label: t("collectFrom.option.graph") },
                                ]}
                                onChange={value => void store.update({ collectFrom: value === "graph" ? "graph" : "gameStart" })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label={t("openAt.label")}
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.openAt}
                                disabled={writes.disabled}
                                options={[
                                    { value: "hidden", label: t("openAt.option.hidden") },
                                    { value: "hud", label: t("openAt.option.hud") },
                                    { value: "inspector", label: t("openAt.option.inspector") },
                                ]}
                                onChange={value => void store.update({ openAt: String(value) as InspectorSettings["openAt"] })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label={t("corner.label")}
                        control={
                            <ui.Select
                                size="sm"
                                value={settings.corner}
                                disabled={writes.disabled}
                                options={[
                                    { value: "top-left", label: t("corner.option.topLeft") },
                                    { value: "top-right", label: t("corner.option.topRight") },
                                    { value: "bottom-left", label: t("corner.option.bottomLeft") },
                                    { value: "bottom-right", label: t("corner.option.bottomRight") },
                                ]}
                                onChange={value => void store.update({ corner: String(value) as InspectorSettings["corner"] })}
                            />
                        }
                    />
                </ui.Panel.Section>

                <ui.Panel.Section title={t("section.collection")}>
                    <ui.Panel.Row
                        label={t("instrumentAssets.label")}
                        description={t("instrumentAssets.description")}
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
                        label={t("historySeconds.label")}
                        description={t("historySeconds.description")}
                        control={
                            <ui.Select
                                size="sm"
                                value={String(settings.historySeconds)}
                                disabled={writes.disabled}
                                options={HISTORY_SECONDS_CHOICES.map(seconds => ({
                                    value: String(seconds),
                                    label: seconds >= 60
                                        ? t("historySeconds.minutes", { count: seconds / 60 })
                                        : t("historySeconds.seconds", { count: seconds }),
                                }))}
                                onChange={value => void store.update({ historySeconds: Number(value) })}
                            />
                        }
                    />
                    <ui.Panel.Row
                        label={t("logOnCapture.label")}
                        description={t("logOnCapture.description")}
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

                <ui.Panel.Section title={t("section.inGame")}>
                    <ui.Panel.Row
                        label={t("opening.label")}
                        description={t("opening.description")}
                    />
                    <ui.Panel.Row
                        label={t("nodes.label")}
                        description={t("nodes.description")}
                    />
                    <ui.Panel.Row
                        label={t("reports.label")}
                        description={t("reports.description")}
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

        const translator = app.services.i18n.createTranslator(EDITOR_MESSAGES);
        const panelBody = () => <PerformancePanel app={app} store={store} />;
        const registerPanel = () => app.services.ui.panels.register({
            id: PANEL_ID,
            title: translator.t("rail.title"),
            icon: <Gauge size={16} />,
            position: PanelPosition.Right,
            component: panelBody,
            order: 680,
        });
        let unregisterPanel = registerPanel();
        // A panel title is a plain string read when the panel is registered (`titleKey` only
        // reaches Studio's own catalogue), so following a language switch means registering it
        // again. Registering an id that is already there replaces the entry in place and leaves the
        // dock open on it, where unregistering first would close it. Only the newest disposer is
        // kept: each of them removes the id, so calling an older one would remove the replacement.
        const stopFollowingLocale = app.services.i18n.onLocaleChange(() => {
            unregisterPanel = registerPanel();
        });

        return async () => {
            await stopFollowingLocale();
            await unregisterPanel();
            unregisterReloader();
        };
    },
});
