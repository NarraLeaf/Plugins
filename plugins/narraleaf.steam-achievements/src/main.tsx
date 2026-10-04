/**
 * Studio entry: the achievement editor.
 *
 * It is an **editor tab**, not a sidebar panel — the stats table needs width the
 * right rail does not have. The left rail keeps one icon whose only job is to open
 * the tab (`railAction`), which is how the dashboard does it.
 *
 * The tab asks only for what the game uses: the Steam App ID, each achievement's
 * API Name, and each stat's API Name, type and bounds. What a player sees of an
 * achievement - its name, description and icons - is set on the Steamworks
 * partner site and drawn by Steam, so it is not asked for a second time here.
 *
 * Layout note: the editor group clips its content host, so the tab sizes itself
 * to the host and brings its own scroller.
 *
 * Style note: a third-party plugin bundle is not scanned by Studio's Tailwind
 * build, so only utilities Studio itself already emits will have any effect.
 * Anything layout-specific (grid tracks, column widths) is therefore an inline
 * style, deliberately.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Plus, Trash2, Trophy } from "lucide-react";
import {
    PanelPosition,
    definePlugin,
    ui,
    type BlueprintInspectorParamSelectOption,
    type FreezeGuard,
    type PluginApp,
} from "narraleaf-studio/plugin";
import {
    CATALOG_NAMESPACE,
    CATALOG_VERSION,
    STEAM_API_NAME_PATTERN,
    emptyCatalog,
    issuesBySubject,
    normalizeCatalog,
    validateCatalog,
    type Achievement,
    type AchievementCatalog,
    type CatalogIssue,
    type SteamStat,
    type SteamStatType,
} from "./catalog";
import {
    ACHIEVEMENT_OPTIONS_SOURCE,
    PLUGIN_ID,
    STAT_OPTIONS_SOURCE,
    createSteamAchievementNodes,
} from "./nodes";
import { MESSAGES, type Translate } from "./i18n";

const RAIL_ID = `${PLUGIN_ID}.rail`;
const TAB_ID = `${PLUGIN_ID}.editor`;

/** Achievement row tracks: api name, delete. */
const ACHIEVEMENT_COLUMNS = "minmax(12rem, 24rem) 2rem";
const STAT_COLUMNS = "12rem 7rem 7rem 7rem 7rem 7rem 2rem";

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
        // Bail *before* touching memory, not after. A frozen project discards
        // the write at the boundary, so mutating first would leave the tab
        // showing a catalog the disk does not have — and the next thaw would
        // write that phantom over whatever version the author restored.
        if (app.services.workspace.frozen) {
            return;
        }
        catalog = normalizeCatalog(next);
        notify();
        await app.services.storage.writeJson(CATALOG_NAMESPACE, {
            ...catalog,
            version: CATALOG_VERSION,
        });
    };

    return {
        /**
         * Read the catalog off disk. Also the reloader: version control replaces
         * the working tree under us, and a store that kept its pre-restore copy
         * in RAM would write it back on the author's next edit.
         */
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
            catalog.achievements.map(achievement => ({ value: achievement.id, label: achievement.id })),
        getStatOptions: (): BlueprintInspectorParamSelectOption[] =>
            catalog.stats.map(stat => ({ value: stat.id, label: stat.id })),
        patch: (patch: Partial<AchievementCatalog>) => commit({ ...catalog, ...patch }),
        renameAchievement: (id: string, next: string) => commit({
            ...catalog,
            achievements: catalog.achievements.map(item => (item.id === id ? { ...item, id: next } : item)),
        }),
        patchStat: (id: string, patch: Partial<SteamStat>) => commit({
            ...catalog,
            stats: catalog.stats.map(item => (item.id === id ? { ...item, ...patch } : item)),
        }),
        addAchievement: () => commit({
            ...catalog,
            achievements: [
                ...catalog.achievements,
                { id: uniqueId("ACHIEVEMENT", catalog.achievements.map(item => item.id)) },
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

function AchievementsTab({ app, store }: { app: PluginApp; store: CatalogStore }) {
    const [catalog, setCatalog] = useState<AchievementCatalog>(() => store.get());
    const [query, setQuery] = useState("");
    // Only the writes are switched off. Searching and scrolling the table are
    // the whole point of looking at a frozen version, so they stay live.
    const freeze = ui.useFreezeGuard();
    const t = useTranslate(app);

    useEffect(() => store.subscribe(() => setCatalog({ ...store.get() })), [store]);

    const issues = useMemo(() => validateCatalog(catalog, t), [catalog, t]);
    const bySubject = useMemo(() => issuesBySubject(issues), [issues]);
    const catalogIssue = issues.find(issue => !issue.subjectId);
    const errorCount = issues.filter(issue => issue.severity === "error").length;
    const warningCount = issues.length - errorCount;

    const achievements = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return needle
            ? catalog.achievements.filter(achievement => achievement.id.toLowerCase().includes(needle))
            : catalog.achievements;
    }, [catalog.achievements, query]);

    const run = (action: Promise<void>) => {
        void action.catch((error: unknown) => {
            app.services.ui.notifications.error(error instanceof Error ? error.message : String(error));
        });
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface text-fg">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
                <span className="text-xs text-fg-muted">{t("toolbar.appId")}</span>
                {/* The input fills its parent, so the parent sets the width. A
                    draft, like every other field: bound straight to the store,
                    this wrote the whole catalog to disk on every keystroke. */}
                <div style={{ width: "9rem" }}>
                    <DraftInput
                        value={catalog.appId ?? ""}
                        ariaLabel={t("toolbar.appId")}
                        allowEmpty
                        {...freeze.writes()}
                        onCommit={appId => run(store.patch({ appId }))}
                    />
                </div>
                {catalogIssue && <span className="text-xs text-warning">{catalogIssue.message}</span>}
                <div className="flex-1" />
                {(errorCount > 0 || warningCount > 0) && (
                    <span className="text-xs">
                        {errorCount > 0 && <span className="text-danger">{t("toolbar.errors", { count: errorCount })}</span>}
                        {errorCount > 0 && warningCount > 0 && <span className="text-fg-subtle"> · </span>}
                        {warningCount > 0 && <span className="text-warning">{t("toolbar.warnings", { count: warningCount })}</span>}
                    </span>
                )}
                <ui.SearchInput
                    size="sm"
                    placeholder={t("toolbar.searchPlaceholder")}
                    value={query}
                    className="w-56"
                    onChange={event => setQuery(event.target.value)}
                />
            </div>

            <div className="flex flex-col gap-1 border-b border-edge px-3 py-2 text-xs text-fg-subtle">
                <span>{t("notice.steamworks")}</span>
                <span>{t("notice.sync")}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-auto">
                <div className="min-w-max">
                    <SectionHeader
                        title={t("achievements.title")}
                        addLabel={t("achievements.add")}
                        freeze={freeze}
                        onAdd={() => run(store.addAchievement())}
                    />
                    <HeaderRow columns={ACHIEVEMENT_COLUMNS} labels={[t("achievements.apiName"), ""]} />
                    {achievements.length === 0 ? (
                        <div className="px-3 py-6 text-xs text-fg-subtle">
                            {catalog.achievements.length === 0 ? t("achievements.empty") : t("achievements.noMatches")}
                        </div>
                    ) : achievements.map(achievement => (
                        <AchievementRow
                            key={achievement.id}
                            t={t}
                            achievement={achievement}
                            freeze={freeze}
                            issues={bySubject.get(achievement.id) ?? []}
                            onRename={id => run(store.renameAchievement(achievement.id, id))}
                            onRemove={() => run(store.removeAchievement(achievement.id))}
                        />
                    ))}

                    <SectionHeader
                        title={t("stats.title")}
                        addLabel={t("stats.add")}
                        freeze={freeze}
                        onAdd={() => run(store.addStat())}
                    />
                    <HeaderRow
                        columns={STAT_COLUMNS}
                        labels={[
                            t("stats.apiName"),
                            t("stats.type"),
                            t("stats.default"),
                            t("stats.min"),
                            t("stats.max"),
                            t("stats.incrementOnly"),
                            "",
                        ]}
                    />
                    {catalog.stats.length === 0 ? (
                        <div className="px-3 py-6 text-xs text-fg-subtle">{t("stats.empty")}</div>
                    ) : catalog.stats.map(stat => (
                        <StatRow
                            key={stat.id}
                            t={t}
                            stat={stat}
                            freeze={freeze}
                            issues={bySubject.get(stat.id) ?? []}
                            onPatch={patch => run(store.patchStat(stat.id, patch))}
                            onRemove={() => run(store.removeStat(stat.id))}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

function SectionHeader({
    title,
    addLabel,
    freeze,
    onAdd,
}: {
    title: string;
    addLabel: string;
    freeze: FreezeGuard;
    onAdd: () => void;
}) {
    return (
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <span className="text-xs font-semibold text-fg-muted">{title}</span>
            <ui.Button size="sm" variant="secondary" {...freeze.writes()} onClick={onAdd}>
                <Plus size={13} />
                {addLabel}
            </ui.Button>
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
    t,
    achievement,
    freeze,
    issues,
    onRename,
    onRemove,
}: {
    t: Translate;
    achievement: Achievement;
    freeze: FreezeGuard;
    issues: CatalogIssue[];
    onRename: (id: string) => void;
    onRemove: () => void;
}) {
    const error = issues.find(issue => issue.severity === "error");

    return (
        <div className="border-b border-edge-subtle px-3 py-1.5">
            <div className="grid items-center gap-2" style={{ gridTemplateColumns: ACHIEVEMENT_COLUMNS }}>
                <DraftInput
                    value={achievement.id}
                    variant={STEAM_API_NAME_PATTERN.test(achievement.id) ? "default" : "error"}
                    {...freeze.writes()}
                    onCommit={onRename}
                />
                <ui.IconButton
                    size="sm"
                    variant="danger"
                    aria-label={t("achievements.delete")}
                    {...freeze.writes()}
                    onClick={onRemove}
                >
                    <Trash2 size={13} />
                </ui.IconButton>
            </div>
            {error && (
                <div className="text-xs text-danger">
                    {error.message}
                    {issues.length > 1 && ` (+${issues.length - 1})`}
                </div>
            )}
        </div>
    );
}

function StatRow({
    t,
    stat,
    freeze,
    issues,
    onPatch,
    onRemove,
}: {
    t: Translate;
    stat: SteamStat;
    freeze: FreezeGuard;
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
            {...freeze.writes()}
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
                    {...freeze.writes()}
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
                    {...freeze.writes()}
                    onChange={value => onPatch({ type: String(value) as SteamStatType })}
                />
                {numberField(stat.defaultValue, next => onPatch({ defaultValue: next ?? 0 }))}
                {numberField(stat.min, next => onPatch({ min: next }))}
                {numberField(stat.max, next => onPatch({ max: next }))}
                <ui.Switch
                    size="sm"
                    checked={stat.incrementOnly === true}
                    {...freeze.writes()}
                    onCheckedChange={incrementOnly => onPatch({ incrementOnly })}
                />
                <ui.IconButton
                    size="sm"
                    variant="danger"
                    aria-label={t("stats.delete")}
                    {...freeze.writes()}
                    onClick={onRemove}
                >
                    <Trash2 size={13} />
                </ui.IconButton>
            </div>
            {error && <div className="text-xs text-danger">{error.message}</div>}
        </div>
    );
}

/**
 * The plugin's translator, re-rendering the caller on a language switch.
 *
 * The returned function changes identity with the locale, so a memo that words
 * its result (the catalog checks) recomputes too.
 */
function useTranslate(app: PluginApp): Translate {
    const translator = useMemo(() => app.services.i18n.createTranslator(MESSAGES), [app]);
    const subscribe = useCallback((listener: () => void) => {
        const cleanup = app.services.i18n.onLocaleChange(() => listener());
        return () => {
            void cleanup();
        };
    }, [app]);
    const locale = useSyncExternalStore(subscribe, () => app.services.i18n.locale);
    // `locale` is in the deps for the new identity, not for its value: the translator
    // resolves against the editor language at call time.
    return useCallback((key, params) => translator.t(key, params), [translator, locale]);
}

/** Local draft so typing does not re-persist the whole catalog on every keystroke. */
function DraftInput({
    value,
    onCommit,
    allowEmpty = false,
    variant,
    className,
    placeholder,
    ariaLabel,
    disabled,
    title,
}: {
    value: string;
    onCommit: (next: string) => void;
    allowEmpty?: boolean;
    variant?: "default" | "error";
    className?: string;
    placeholder?: string;
    ariaLabel?: string;
    /** Spread from `FreezeGuard.writes()` at every call site that edits the catalog. */
    disabled?: boolean;
    title?: string;
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
            placeholder={placeholder}
            aria-label={ariaLabel}
            disabled={disabled}
            title={title}
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
        const translator = app.services.i18n.createTranslator(MESSAGES);
        const t: Translate = (key, params) => translator.t(key, params);

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
        app.services.blueprintNodes.registerMany(createSteamAchievementNodes(() => store.get(), t));

        // Enrol in the pass Studio runs after a restore, a thaw, or entering a
        // version view, so the tab and the node pickers show the version that is
        // actually on disk.
        const unregisterReloader = app.services.workspace.registerReloader(() => store.load());

        // Worded on every open: a tab opened after a language switch takes the new title.
        const openTab = () => {
            app.services.ui.editors.open({
                id: TAB_ID,
                title: t("tab.title"),
                icon: <Trophy size={14} />,
                component: () => <AchievementsTab app={app} store={store} />,
            });
        };

        const registerRail = () => app.services.ui.panels.register({
            id: RAIL_ID,
            title: t("tab.title"),
            icon: <Trophy size={16} />,
            position: PanelPosition.Left,
            railAction: openTab,
            order: 660,
        });
        let unregisterRail = registerRail();
        // A panel title is a plain string read once per registration (`titleKey` only
        // reaches Studio's own catalog), so following a language switch means
        // registering the rail entry again. Chained, so the old entry is gone before
        // the new one claims its id, however quickly the language changes.
        let railSwap = Promise.resolve();
        const stopFollowingLocale = app.services.i18n.onLocaleChange(() => {
            railSwap = railSwap.then(async () => {
                await unregisterRail();
                unregisterRail = registerRail();
            });
        });

        return async () => {
            await stopFollowingLocale();
            await railSwap;
            await unregisterRail();
            unregisterReloader();
            unregisterAchievementOptions();
            unregisterStatOptions();
        };
    },
});
