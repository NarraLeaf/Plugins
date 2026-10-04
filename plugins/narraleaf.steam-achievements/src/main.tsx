/**
 * Studio entry: the achievements side panel.
 *
 * A panel rather than an editor tab. What the author keeps here is the Steam App
 * ID and two short lists of API Names, and it is read most while wiring blueprint
 * nodes - so it sits beside the graph instead of replacing it, the way the Menu
 * Bar panel does.
 *
 * It is laid out like that panel too: one accordion row per achievement or stat,
 * named by its API Name, opening onto its fields; one "add" under each list;
 * delete inside the row it removes. One row is open at a time across both lists.
 *
 * What a player sees of an achievement - its name, description and icons - is
 * set on the Steamworks partner site and drawn by Steam, so it is not asked for
 * here.
 *
 * Style note: a third-party plugin bundle is not scanned by Studio's Tailwind
 * build, so only utilities Studio itself already emits will have any effect.
 * Widths are therefore inline styles, deliberately.
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

const PANEL_ID = `${PLUGIN_ID}.panel`;

/** Field widths, matching the Menu Bar panel's so a field fits beside its label one rail in. */
const ID_FIELD_WIDTH = "10rem";
const NUMBER_FIELD_WIDTH = "6rem";

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
        // the write at the boundary, so mutating first would leave the panel
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
        setAppId: (appId: string) => commit({ ...catalog, appId }),
        renameAchievement: (index: number, id: string) => commit({
            ...catalog,
            achievements: catalog.achievements.map((item, at) => (at === index ? { ...item, id } : item)),
        }),
        patchStat: (index: number, patch: Partial<SteamStat>) => commit({
            ...catalog,
            stats: catalog.stats.map((item, at) => (at === index ? { ...item, ...patch } : item)),
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
        removeAchievement: (index: number) => commit({
            ...catalog,
            achievements: catalog.achievements.filter((_, at) => at !== index),
        }),
        removeStat: (index: number) => commit({
            ...catalog,
            stats: catalog.stats.filter((_, at) => at !== index),
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

/* ------------------------------------------------------------------ panel */

/**
 * Which row is open: an achievement or a stat, by position.
 *
 * By position rather than by API Name, so renaming the open row keeps it open and
 * two rows that briefly share a name are still two rows.
 */
const achievementKey = (index: number) => `achievement:${index}`;
const statKey = (index: number) => `stat:${index}`;

function AchievementsPanel({ app, store }: { app: PluginApp; store: CatalogStore }) {
    const [catalog, setCatalog] = useState<AchievementCatalog>(() => store.get());
    const [openKey, setOpenKey] = useState<string | null>(null);
    // The row just added, whose name field takes focus so typing replaces the placeholder name.
    const [addedKey, setAddedKey] = useState<string | null>(null);
    const freeze = ui.useFreezeGuard();
    const t = useTranslate(app);

    useEffect(() => store.subscribe(() => setCatalog({ ...store.get() })), [store]);

    const issues = useMemo(() => validateCatalog(catalog, t), [catalog, t]);
    const bySubject = useMemo(() => issuesBySubject(issues), [issues]);
    const catalogIssue = issues.find(issue => !issue.subjectId);

    const run = (action: Promise<void>) => {
        void action.catch((error: unknown) => {
            app.services.ui.notifications.error(error instanceof Error ? error.message : String(error));
        });
    };

    const open = (key: string | null) => {
        setOpenKey(key);
        setAddedKey(null);
    };

    const add = (key: string, action: Promise<void>) => {
        run(action);
        setOpenKey(key);
        setAddedKey(key);
    };

    const remove = (action: Promise<void>) => {
        run(action);
        open(null);
    };

    // One open row across both lists: each accordion is told whether the open key is one of its own.
    const openIn = (prefix: string) => (openKey?.startsWith(prefix) ? [openKey] : []);
    const onOpenChange = (items: string[]) => open(items[items.length - 1] ?? null);

    return (
        <ui.Panel.Root>
            <ui.Panel.Header title={t("panel.title")} />

            <ui.Panel.Row
                label={t("appId.label")}
                control={(
                    <div style={{ width: ID_FIELD_WIDTH }}>
                        <DraftInput
                            value={catalog.appId ?? ""}
                            ariaLabel={t("appId.label")}
                            allowEmpty
                            {...freeze.writes()}
                            onCommit={appId => run(store.setAppId(appId))}
                        />
                    </div>
                )}
            />
            {catalogIssue && <div className="text-2xs text-warning">{catalogIssue.message}</div>}
            <div className="pb-2 pt-1 text-2xs text-fg-subtle">{t("appId.sync")}</div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                <ui.Panel.Section title={t("achievements.title")}>
                    {catalog.achievements.length === 0 ? (
                        <EmptyLine title={t("achievements.empty")} hint={t("achievements.emptyHint")} />
                    ) : (
                        <ui.Accordion
                            multiple={false}
                            disableAnimation
                            openItems={openIn("achievement:")}
                            onOpenChange={onOpenChange}
                        >
                            {catalog.achievements.map((achievement, index) => {
                                const key = achievementKey(index);
                                const error = (bySubject.get(achievement.id) ?? [])
                                    .find(issue => issue.severity === "error");
                                return (
                                    <ui.AccordionItem
                                        key={key}
                                        id={key}
                                        title={<RowTitle name={achievement.id} error={Boolean(error)} />}
                                    >
                                        <Rail>
                                            <IdField
                                                label={t("achievements.apiName")}
                                                value={achievement.id}
                                                error={error}
                                                autoFocus={addedKey === key}
                                                freeze={freeze}
                                                onCommit={id => run(store.renameAchievement(index, id))}
                                            />
                                            <RemoveButton
                                                label={t("achievements.delete")}
                                                freeze={freeze}
                                                onClick={() => remove(store.removeAchievement(index))}
                                            />
                                        </Rail>
                                    </ui.AccordionItem>
                                );
                            })}
                        </ui.Accordion>
                    )}
                    <AddButton
                        label={t("achievements.add")}
                        freeze={freeze}
                        onClick={() => add(achievementKey(catalog.achievements.length), store.addAchievement())}
                    />
                </ui.Panel.Section>

                <ui.Panel.Section title={t("stats.title")}>
                    {catalog.stats.length === 0 ? (
                        <EmptyLine title={t("stats.empty")} />
                    ) : (
                        <ui.Accordion
                            multiple={false}
                            disableAnimation
                            openItems={openIn("stat:")}
                            onOpenChange={onOpenChange}
                        >
                            {catalog.stats.map((stat, index) => {
                                const key = statKey(index);
                                const error = (bySubject.get(stat.id) ?? [])
                                    .find(issue => issue.severity === "error");
                                return (
                                    <ui.AccordionItem
                                        key={key}
                                        id={key}
                                        title={(
                                            <RowTitle
                                                name={stat.id}
                                                error={Boolean(error)}
                                                detail={statDetail(stat, t)}
                                            />
                                        )}
                                    >
                                        <Rail>
                                            <StatFields
                                                t={t}
                                                stat={stat}
                                                error={error}
                                                autoFocus={addedKey === key}
                                                freeze={freeze}
                                                onPatch={patch => run(store.patchStat(index, patch))}
                                            />
                                            <RemoveButton
                                                label={t("stats.delete")}
                                                freeze={freeze}
                                                onClick={() => remove(store.removeStat(index))}
                                            />
                                        </Rail>
                                    </ui.AccordionItem>
                                );
                            })}
                        </ui.Accordion>
                    )}
                    <AddButton
                        label={t("stats.add")}
                        freeze={freeze}
                        onClick={() => add(statKey(catalog.stats.length), store.addStat())}
                    />
                </ui.Panel.Section>
            </div>
        </ui.Panel.Root>
    );
}

/** A collapsed row: the API Name, in the danger colour while it is one Steam would refuse. */
function RowTitle({ name, error, detail }: { name: string; error: boolean; detail?: string }) {
    return (
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className={error ? "truncate text-2xs text-danger" : "truncate text-2xs"}>{name}</span>
            {detail && <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{detail}</span>}
        </span>
    );
}

/** What a stat row says while it is closed: its type, and that it only goes up when it does. */
function statDetail(stat: SteamStat, t: Translate): string {
    const type = t(stat.type === "float" ? "stats.typeFloat" : "stats.typeInt");
    return stat.incrementOnly ? `${type} · ${t("stats.incrementOnly")}` : type;
}

/** The line that carries an open row's fields, indented past the row's own title. */
function Rail({ children }: { children: React.ReactNode }) {
    return <div className="ml-3 border-l border-edge pl-3">{children}</div>;
}

function EmptyLine({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className="py-1">
            <div className="text-2xs text-fg-muted">{title}</div>
            {hint && <div className="pt-0.5 text-2xs text-fg-subtle">{hint}</div>}
        </div>
    );
}

function AddButton({ label, freeze, onClick }: { label: string; freeze: FreezeGuard; onClick: () => void }) {
    return (
        <div className="pt-1">
            <ui.Button size="sm" variant="ghost" {...freeze.writes()} onClick={onClick}>
                <Plus size={13} />
                {label}
            </ui.Button>
        </div>
    );
}

function RemoveButton({ label, freeze, onClick }: { label: string; freeze: FreezeGuard; onClick: () => void }) {
    return (
        <div className="pt-1">
            <ui.Button size="sm" variant="ghost" {...freeze.writes()} onClick={onClick}>
                <Trash2 size={12} />
                {label}
            </ui.Button>
        </div>
    );
}

/** An API Name field, with the reason beneath it whenever Steam would refuse the name. */
function IdField({
    label,
    value,
    error,
    autoFocus,
    freeze,
    onCommit,
}: {
    label: string;
    value: string;
    error: CatalogIssue | undefined;
    autoFocus: boolean;
    freeze: FreezeGuard;
    onCommit: (next: string) => void;
}) {
    return (
        <>
            <ui.Panel.Row
                label={label}
                control={(
                    <div style={{ width: ID_FIELD_WIDTH }}>
                        <DraftInput
                            value={value}
                            ariaLabel={label}
                            variant={STEAM_API_NAME_PATTERN.test(value) ? "default" : "error"}
                            autoFocus={autoFocus}
                            {...freeze.writes()}
                            onCommit={onCommit}
                        />
                    </div>
                )}
            />
            {error && <div className="pb-1 text-2xs text-danger">{error.message}</div>}
        </>
    );
}

function StatFields({
    t,
    stat,
    error,
    autoFocus,
    freeze,
    onPatch,
}: {
    t: Translate;
    stat: SteamStat;
    error: CatalogIssue | undefined;
    autoFocus: boolean;
    freeze: FreezeGuard;
    onPatch: (patch: Partial<SteamStat>) => void;
}) {
    const numberRow = (
        label: string,
        value: number | undefined,
        commit: (next: number | undefined) => void,
        placeholder?: string,
    ) => (
        <ui.Panel.Row
            label={label}
            control={(
                <div style={{ width: NUMBER_FIELD_WIDTH }}>
                    <DraftInput
                        value={value === undefined ? "" : String(value)}
                        ariaLabel={label}
                        placeholder={placeholder}
                        allowEmpty
                        {...freeze.writes()}
                        onCommit={text => {
                            const parsed = Number.parseFloat(text);
                            commit(text.trim() && Number.isFinite(parsed) ? parsed : undefined);
                        }}
                    />
                </div>
            )}
        />
    );

    return (
        <>
            <IdField
                label={t("stats.apiName")}
                value={stat.id}
                error={error}
                autoFocus={autoFocus}
                freeze={freeze}
                onCommit={id => onPatch({ id })}
            />
            <ui.Panel.Row
                label={t("stats.type")}
                control={(
                    <ui.Select
                        size="sm"
                        value={stat.type}
                        options={[
                            { value: "int", label: t("stats.typeInt") },
                            { value: "float", label: t("stats.typeFloat") },
                        ]}
                        {...freeze.writes()}
                        onChange={value => onPatch({ type: String(value) as SteamStatType })}
                    />
                )}
            />
            {numberRow(t("stats.default"), stat.defaultValue, next => onPatch({ defaultValue: next ?? 0 }))}
            {numberRow(t("stats.min"), stat.min, next => onPatch({ min: next }), t("stats.unbounded"))}
            {numberRow(t("stats.max"), stat.max, next => onPatch({ max: next }), t("stats.unbounded"))}
            <ui.Panel.Row
                label={t("stats.incrementOnly")}
                control={(
                    <ui.Switch
                        size="sm"
                        checked={stat.incrementOnly === true}
                        aria-label={t("stats.incrementOnly")}
                        {...freeze.writes()}
                        onCheckedChange={incrementOnly => onPatch({ incrementOnly })}
                    />
                )}
            />
        </>
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
    placeholder,
    ariaLabel,
    autoFocus,
    disabled,
    title,
}: {
    value: string;
    onCommit: (next: string) => void;
    allowEmpty?: boolean;
    variant?: "default" | "error";
    placeholder?: string;
    ariaLabel?: string;
    /** Focus on mount with the text selected, so typing replaces a placeholder name. */
    autoFocus?: boolean;
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
            placeholder={placeholder}
            aria-label={ariaLabel}
            autoFocus={autoFocus}
            onFocus={autoFocus ? event => event.currentTarget.select() : undefined}
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
        // version view, so the panel and the node pickers show the version that is
        // actually on disk.
        const unregisterReloader = app.services.workspace.registerReloader(() => store.load());

        const unregisterPanel = app.services.ui.panels.register({
            id: PANEL_ID,
            // A getter, read at render: `t()` resolves against the live editor
            // language, so a language switch re-titles the panel without
            // registering it again.
            get title() {
                return t("panel.title");
            },
            icon: <Trophy size={16} />,
            position: PanelPosition.Left,
            component: () => <AchievementsPanel app={app} store={store} />,
            defaultVisible: false,
            order: 660,
        });

        return async () => {
            await unregisterPanel();
            unregisterReloader();
            unregisterAchievementOptions();
            unregisterStatOptions();
        };
    },
});
