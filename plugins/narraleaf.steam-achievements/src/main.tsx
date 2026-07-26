/**
 * Studio entry: the achievement editor.
 *
 * It is an **editor tab**, not a sidebar panel — an achievement is a row with an
 * API name, two icons, localized text and a progress binding, and that table
 * needs width the right rail does not have. The left rail keeps one icon whose
 * only job is to open the tab (`railAction`), which is how the dashboard does it.
 *
 * Layout note: the editor group clips its content host, so the tab sizes itself
 * to the host and brings its own scroller.
 *
 * Style note: a third-party plugin bundle is not scanned by Studio's Tailwind
 * build, so only utilities Studio itself already emits will have any effect.
 * Anything layout-specific (grid tracks, column widths) is therefore an inline
 * style, deliberately.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Image, Plus, Trash2, Trophy, X } from "lucide-react";
import {
    AssetType,
    PanelPosition,
    definePlugin,
    ui,
    type Asset,
    type BlueprintInspectorParamSelectOption,
    type PluginApp,
} from "narraleaf-studio/plugin";
import {
    CATALOG_NAMESPACE,
    CATALOG_VERSION,
    STEAM_API_NAME_PATTERN,
    emptyCatalog,
    issuesBySubject,
    localizedText,
    normalizeCatalog,
    validateCatalog,
    type Achievement,
    type AchievementCatalog,
    type CatalogIssue,
    type LocaleCode,
    type SteamStat,
    type SteamStatType,
} from "./catalog";
import {
    ACHIEVEMENT_OPTIONS_SOURCE,
    PLUGIN_ID,
    STAT_OPTIONS_SOURCE,
    createSteamAchievementNodes,
} from "./nodes";

const RAIL_ID = `${PLUGIN_ID}.rail`;
const TAB_ID = `${PLUGIN_ID}.editor`;

/** Achievement row tracks: icons, api name, name, description, hidden, progress, delete. */
const ACHIEVEMENT_COLUMNS = "4.5rem 12rem minmax(9rem, 1fr) minmax(12rem, 1.6fr) 3rem 15rem 2rem";
const STAT_COLUMNS = "12rem 7rem 7rem 7rem 7rem 5rem 2rem";

type CatalogStore = ReturnType<typeof createCatalogStore>;

function createCatalogStore(app: PluginApp) {
    let catalog: AchievementCatalog = emptyCatalog();
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) {
            listener();
        }
        app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
    };

    const commit = async (next: AchievementCatalog) => {
        catalog = normalizeCatalog(next);
        notify();
        await app.services.storage.writeJson(CATALOG_NAMESPACE, {
            ...catalog,
            version: CATALOG_VERSION,
        });
    };

    return {
        async load() {
            catalog = normalizeCatalog(await app.services.storage.readJson(CATALOG_NAMESPACE));
            notify();
        },
        get: () => catalog,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getAchievementOptions: (): BlueprintInspectorParamSelectOption[] =>
            catalog.achievements.map(achievement => ({
                value: achievement.id,
                label: localizedText(achievement.name, catalog.locales[0], catalog.locales) || achievement.id,
            })),
        getStatOptions: (): BlueprintInspectorParamSelectOption[] =>
            catalog.stats.map(stat => ({ value: stat.id, label: stat.id })),
        patch: (patch: Partial<AchievementCatalog>) => commit({ ...catalog, ...patch }),
        patchAchievement: (id: string, patch: Partial<Achievement>) => commit({
            ...catalog,
            achievements: catalog.achievements.map(item => (item.id === id ? { ...item, ...patch } : item)),
        }),
        patchStat: (id: string, patch: Partial<SteamStat>) => commit({
            ...catalog,
            stats: catalog.stats.map(item => (item.id === id ? { ...item, ...patch } : item)),
        }),
        addAchievement: () => commit({
            ...catalog,
            achievements: [
                ...catalog.achievements,
                {
                    id: uniqueId("ACHIEVEMENT", catalog.achievements.map(item => item.id)),
                    name: {},
                    description: {},
                    hidden: false,
                },
            ],
        }),
        addStat: () => commit({
            ...catalog,
            stats: [
                ...catalog.stats,
                { id: uniqueId("STAT", catalog.stats.map(item => item.id)), type: "int", defaultValue: 0 },
            ],
        }),
        removeAchievement: (id: string) => commit({
            ...catalog,
            achievements: catalog.achievements.filter(item => item.id !== id),
        }),
        removeStat: (id: string) => commit({
            ...catalog,
            stats: catalog.stats.filter(item => item.id !== id),
        }),
    };
}

function uniqueId(prefix: string, taken: string[]): string {
    for (let index = 1; ; index += 1) {
        const candidate = `${prefix}_${index}`;
        if (!taken.includes(candidate)) {
            return candidate;
        }
    }
}

/* -------------------------------------------------------------------- tab */

type IconSlot = "iconAchievedAssetId" | "iconUnachievedAssetId";

function AchievementsTab({ app, store }: { app: PluginApp; store: CatalogStore }) {
    const [catalog, setCatalog] = useState<AchievementCatalog>(() => store.get());
    const [locale, setLocale] = useState<LocaleCode>(() => store.get().locales[0]);
    const [query, setQuery] = useState("");
    const [newLocale, setNewLocale] = useState("");
    const [iconTarget, setIconTarget] = useState<{ achievementId: string; slot: IconSlot } | null>(null);
    const anchorRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => store.subscribe(() => setCatalog({ ...store.get() })), [store]);
    useEffect(() => {
        if (!catalog.locales.includes(locale)) {
            setLocale(catalog.locales[0]);
        }
    }, [catalog.locales, locale]);

    const issues = useMemo(() => validateCatalog(catalog), [catalog]);
    const bySubject = useMemo(() => issuesBySubject(issues), [issues]);
    const errorCount = issues.filter(issue => issue.severity === "error").length;
    const warningCount = issues.length - errorCount;

    const achievements = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) {
            return catalog.achievements;
        }
        return catalog.achievements.filter(achievement =>
            achievement.id.toLowerCase().includes(needle) ||
            Object.values(achievement.name).some(text => text.toLowerCase().includes(needle))
        );
    }, [catalog.achievements, query]);

    const statOptions = useMemo(
        () => [{ value: "", label: "None" }, ...catalog.stats.map(stat => ({ value: stat.id, label: stat.id }))],
        [catalog.stats],
    );

    const run = (action: Promise<void>) => {
        void action.catch((error: unknown) => {
            app.services.ui.notifications.error(error instanceof Error ? error.message : String(error));
        });
    };

    const setLocalizedText = (achievement: Achievement, field: "name" | "description", text: string) => {
        run(store.patchAchievement(achievement.id, { [field]: { ...achievement[field], [locale]: text } }));
    };

    const addLocale = () => {
        const code = newLocale.trim();
        if (!code || catalog.locales.includes(code)) {
            return;
        }
        setNewLocale("");
        setLocale(code);
        run(store.patch({ locales: [...catalog.locales, code] }));
    };

    const target = iconTarget
        ? catalog.achievements.find(item => item.id === iconTarget.achievementId)
        : undefined;

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
                <ui.Input
                    size="sm"
                    value={catalog.appId ?? ""}
                    placeholder="Steam App ID"
                    className="w-36"
                    onChange={event => run(store.patch({ appId: event.target.value.trim() }))}
                />
                <ui.SearchInput
                    size="sm"
                    placeholder="Search achievements..."
                    value={query}
                    className="w-56"
                    onChange={event => setQuery(event.target.value)}
                />
                <div className="flex items-center gap-1">
                    <ui.Select
                        size="sm"
                        value={locale}
                        options={catalog.locales.map(code => ({ value: code, label: code }))}
                        onChange={value => setLocale(String(value))}
                    />
                    <ui.Input
                        size="sm"
                        value={newLocale}
                        placeholder="add locale"
                        className="w-24"
                        onChange={event => setNewLocale(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Enter") {
                                addLocale();
                            }
                        }}
                    />
                    <ui.IconButton
                        size="sm"
                        variant="ghost"
                        aria-label="Remove language"
                        title="Remove language"
                        disabled={catalog.locales.length < 2}
                        onClick={() => run(store.patch({
                            locales: catalog.locales.filter(code => code !== locale),
                        }))}
                    >
                        <X size={13} />
                    </ui.IconButton>
                </div>
                <div className="flex-1" />
                {(errorCount > 0 || warningCount > 0) && (
                    <span className="text-xs">
                        {errorCount > 0 && <span className="text-danger">{errorCount} errors</span>}
                        {errorCount > 0 && warningCount > 0 && <span className="text-fg-subtle"> · </span>}
                        {warningCount > 0 && <span className="text-warning">{warningCount} warnings</span>}
                    </span>
                )}
                <ui.Button size="sm" variant="primary" onClick={() => run(store.addAchievement())}>
                    <Plus size={14} />
                    Achievement
                </ui.Button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <div className="min-w-max">
                    <HeaderRow
                        columns={ACHIEVEMENT_COLUMNS}
                        labels={["Icons", "API Name", `Name (${locale})`, `Description (${locale})`, "Hidden", "Progress", ""]}
                    />
                    {achievements.length === 0 ? (
                        <div className="px-3 py-6 text-xs text-fg-subtle">
                            {catalog.achievements.length === 0 ? "No achievements." : "No matches."}
                        </div>
                    ) : achievements.map(achievement => (
                        <AchievementRow
                            key={achievement.id}
                            app={app}
                            achievement={achievement}
                            locale={locale}
                            statOptions={statOptions}
                            issues={bySubject.get(achievement.id) ?? []}
                            onRename={id => run(store.patchAchievement(achievement.id, { id }))}
                            onText={(field, text) => setLocalizedText(achievement, field, text)}
                            onHidden={hidden => run(store.patchAchievement(achievement.id, { hidden }))}
                            onProgress={progress => run(store.patchAchievement(achievement.id, { progress }))}
                            onPickIcon={slot => setIconTarget({ achievementId: achievement.id, slot })}
                            onClearIcon={slot => run(store.patchAchievement(achievement.id, { [slot]: undefined }))}
                            onRemove={() => run(store.removeAchievement(achievement.id))}
                        />
                    ))}

                    <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
                        <span className="text-xs font-semibold text-fg-muted">Stats</span>
                        <ui.Button size="sm" variant="secondary" onClick={() => run(store.addStat())}>
                            <Plus size={13} />
                            Stat
                        </ui.Button>
                    </div>
                    <HeaderRow
                        columns={STAT_COLUMNS}
                        labels={["API Name", "Type", "Default", "Min", "Max", "Inc only", ""]}
                    />
                    {catalog.stats.length === 0 ? (
                        <div className="px-3 py-6 text-xs text-fg-subtle">No stats.</div>
                    ) : catalog.stats.map(stat => (
                        <StatRow
                            key={stat.id}
                            stat={stat}
                            issues={bySubject.get(stat.id) ?? []}
                            onPatch={patch => run(store.patchStat(stat.id, patch))}
                            onRemove={() => run(store.removeStat(stat.id))}
                        />
                    ))}
                </div>
            </div>

            <div ref={anchorRef} className="h-0 w-full" />
            <ui.AssetSelector
                visible={Boolean(iconTarget)}
                assetType={AssetType.Image}
                selectedIds={target && iconTarget ? [target[iconTarget.slot] ?? ""].filter(Boolean) : []}
                anchorRef={anchorRef}
                title={iconTarget?.slot === "iconUnachievedAssetId" ? "Locked icon" : "Unlocked icon"}
                onClose={() => setIconTarget(null)}
                onConfirm={assets => {
                    const picked = assets[0] as Asset | undefined;
                    if (iconTarget && picked) {
                        run(store.patchAchievement(iconTarget.achievementId, { [iconTarget.slot]: picked.id }));
                    }
                    setIconTarget(null);
                }}
            />
        </div>
    );
}

function HeaderRow({ columns, labels }: { columns: string; labels: string[] }) {
    return (
        <div
            className="grid items-center gap-2 border-b border-edge px-3 py-1.5 text-xs text-fg-subtle"
            style={{ gridTemplateColumns: columns }}
        >
            {labels.map((label, index) => <div key={index} className="truncate">{label}</div>)}
        </div>
    );
}

function AchievementRow({
    app,
    achievement,
    locale,
    statOptions,
    issues,
    onRename,
    onText,
    onHidden,
    onProgress,
    onPickIcon,
    onClearIcon,
    onRemove,
}: {
    app: PluginApp;
    achievement: Achievement;
    locale: LocaleCode;
    statOptions: { value: string; label: string }[];
    issues: CatalogIssue[];
    onRename: (id: string) => void;
    onText: (field: "name" | "description", text: string) => void;
    onHidden: (hidden: boolean) => void;
    onProgress: (progress: Achievement["progress"]) => void;
    onPickIcon: (slot: IconSlot) => void;
    onClearIcon: (slot: IconSlot) => void;
    onRemove: () => void;
}) {
    const error = issues.find(issue => issue.severity === "error");
    const warning = issues.find(issue => issue.severity === "warning");

    return (
        <div className="border-b border-edge-subtle px-3 py-1.5">
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: ACHIEVEMENT_COLUMNS }}>
                <div className="flex items-center gap-1">
                    <IconCell
                        app={app}
                        assetId={achievement.iconAchievedAssetId ?? null}
                        title="Unlocked icon"
                        onPick={() => onPickIcon("iconAchievedAssetId")}
                        onClear={() => onClearIcon("iconAchievedAssetId")}
                    />
                    <IconCell
                        app={app}
                        assetId={achievement.iconUnachievedAssetId ?? null}
                        title="Locked icon"
                        onPick={() => onPickIcon("iconUnachievedAssetId")}
                        onClear={() => onClearIcon("iconUnachievedAssetId")}
                    />
                </div>
                <DraftInput
                    value={achievement.id}
                    variant={STEAM_API_NAME_PATTERN.test(achievement.id) ? "default" : "error"}
                    onCommit={onRename}
                />
                <DraftInput
                    value={achievement.name[locale] ?? ""}
                    onCommit={text => onText("name", text)}
                    allowEmpty
                />
                <DraftInput
                    value={achievement.description[locale] ?? ""}
                    onCommit={text => onText("description", text)}
                    allowEmpty
                />
                <ui.Switch
                    size="sm"
                    checked={achievement.hidden}
                    onCheckedChange={onHidden}
                />
                <div className="flex items-center gap-1">
                    <ui.Select
                        size="sm"
                        value={achievement.progress?.statId ?? ""}
                        options={statOptions}
                        portalMenu
                        onChange={value => {
                            const statId = String(value);
                            onProgress(statId ? { statId, max: achievement.progress?.max ?? 0 } : undefined);
                        }}
                    />
                    {achievement.progress && (
                        <DraftInput
                            value={String(achievement.progress.max)}
                            className="w-16"
                            allowEmpty
                            onCommit={text => onProgress({
                                statId: achievement.progress?.statId ?? "",
                                max: Number.parseFloat(text) || 0,
                            })}
                        />
                    )}
                </div>
                <ui.IconButton size="sm" variant="danger" aria-label="Delete achievement" onClick={onRemove}>
                    <Trash2 size={13} />
                </ui.IconButton>
            </div>
            {(error ?? warning) && (
                <div className={`text-xs ${error ? "text-danger" : "text-warning"}`}>
                    {(error ?? warning)?.message}
                    {issues.length > 1 && ` (+${issues.length - 1})`}
                </div>
            )}
        </div>
    );
}

function StatRow({
    stat,
    issues,
    onPatch,
    onRemove,
}: {
    stat: SteamStat;
    issues: CatalogIssue[];
    onPatch: (patch: Partial<SteamStat>) => void;
    onRemove: () => void;
}) {
    const error = issues.find(issue => issue.severity === "error");
    const numberField = (
        value: number | undefined,
        commit: (next: number | undefined) => void,
    ) => (
        <DraftInput
            value={value === undefined ? "" : String(value)}
            allowEmpty
            onCommit={text => {
                const parsed = Number.parseFloat(text);
                commit(text.trim() && Number.isFinite(parsed) ? parsed : undefined);
            }}
        />
    );

    return (
        <div className="border-b border-edge-subtle px-3 py-1.5">
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: STAT_COLUMNS }}>
                <DraftInput
                    value={stat.id}
                    variant={STEAM_API_NAME_PATTERN.test(stat.id) ? "default" : "error"}
                    onCommit={id => onPatch({ id })}
                />
                <ui.Select
                    size="sm"
                    value={stat.type}
                    portalMenu
                    options={[
                        { value: "int", label: "int" },
                        { value: "float", label: "float" },
                    ]}
                    onChange={value => onPatch({ type: String(value) as SteamStatType })}
                />
                {numberField(stat.defaultValue, next => onPatch({ defaultValue: next ?? 0 }))}
                {numberField(stat.min, next => onPatch({ min: next }))}
                {numberField(stat.max, next => onPatch({ max: next }))}
                <ui.Switch
                    size="sm"
                    checked={stat.incrementOnly === true}
                    onCheckedChange={incrementOnly => onPatch({ incrementOnly })}
                />
                <ui.IconButton size="sm" variant="danger" aria-label="Delete stat" onClick={onRemove}>
                    <Trash2 size={13} />
                </ui.IconButton>
            </div>
            {error && <div className="text-xs text-danger">{error.message}</div>}
        </div>
    );
}

function IconCell({
    app,
    assetId,
    title,
    onPick,
    onClear,
}: {
    app: PluginApp;
    assetId: string | null;
    title: string;
    onPick: () => void;
    onClear: () => void;
}) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        let disposed = false;
        let objectUrl: string | null = null;
        const asset = assetId ? app.services.assets.get(AssetType.Image, assetId) : undefined;
        if (!asset) {
            setUrl(null);
            return;
        }
        app.services.assets.createObjectUrl(asset)
            .then(next => {
                if (disposed) {
                    app.services.assets.revokeObjectUrl(next);
                    return;
                }
                objectUrl = next;
                setUrl(next);
            })
            .catch(() => {
                if (!disposed) {
                    setUrl(null);
                }
            });
        return () => {
            disposed = true;
            if (objectUrl) {
                app.services.assets.revokeObjectUrl(objectUrl);
            }
        };
    }, [app, assetId]);

    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded border border-edge bg-surface-sunken"
            onClick={onPick}
            onContextMenu={event => {
                event.preventDefault();
                onClear();
            }}
        >
            {url
                ? <img src={url} alt="" className="h-full w-full object-cover" />
                : <Image size={13} className="text-fg-subtle" />}
        </button>
    );
}

/** Local draft so typing does not re-persist the whole catalog on every keystroke. */
function DraftInput({
    value,
    onCommit,
    allowEmpty = false,
    variant,
    className,
}: {
    value: string;
    onCommit: (next: string) => void;
    allowEmpty?: boolean;
    variant?: "default" | "error";
    className?: string;
}) {
    const [draft, setDraft] = useState(value);

    useEffect(() => {
        setDraft(value);
    }, [value]);

    const commit = () => {
        const next = draft.trim();
        if (next === value || (!next && !allowEmpty)) {
            setDraft(value);
            return;
        }
        onCommit(next);
    };

    return (
        <ui.Input
            size="sm"
            fullWidth
            variant={variant}
            className={className}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    event.currentTarget.blur();
                }
            }}
        />
    );
}

export default definePlugin({
    async setup(app) {
        const store = createCatalogStore(app);
        await store.load();

        const unregisterAchievementOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            ACHIEVEMENT_OPTIONS_SOURCE,
            () => store.getAchievementOptions(),
        );
        const unregisterStatOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            STAT_OPTIONS_SOURCE,
            () => store.getStatOptions(),
        );
        // In the editor the catalog is the live store; the runtime entry reads
        // the copy published with the game instead.
        app.services.blueprintNodes.registerMany(createSteamAchievementNodes(() => store.get()));

        const openTab = () => {
            app.services.ui.editors.open({
                id: TAB_ID,
                title: "Achievements",
                icon: <Trophy size={14} />,
                component: () => <AchievementsTab app={app} store={store} />,
            });
        };

        const unregisterRail = app.services.ui.panels.register({
            id: RAIL_ID,
            title: "Achievements",
            icon: <Trophy size={16} />,
            position: PanelPosition.Left,
            railAction: openTab,
            order: 660,
        });

        return () => {
            unregisterRail();
            unregisterAchievementOptions();
            unregisterStatOptions();
        };
    },
});
