/**
 * Studio entry: one action-bar button, one dialog, and a tracker behind them.
 *
 * ## Why this shape, and not a Settings page
 *
 * The obvious home for three settings is Studio's Settings window, and a plugin
 * cannot reach it: a studio entry loads in the **workspace window only** (never
 * Launcher, Settings, Project Wizard or Dev Mode), and `PluginServices` has no
 * settings contribution point — checked against both `narraleaf-studio@0.5.0`
 * and Studio's current source. So the nearest thing a plugin can build is this:
 * one standalone action, which Studio renders as a single icon button beside the
 * Run control, opening a dialog with the three fields in it.
 *
 * ## Why the dialog gets its own React root
 *
 * An action's `onClick` is imperative — there is no React tree to render a modal
 * into, and the alternative surfaces (a sidebar panel, an editor tab) are the
 * permanent chrome this plugin is meant not to have. The workspace import map
 * publishes `react-dom/client` to plugins precisely so one can be mounted (the
 * prohibition on plugin-owned roots is on the *runtime* entry, which is game
 * code and gets no such external). Studio's `ui` kit reads its translations from
 * a module-level store rather than a React provider, so `ui.Modal` and friends
 * render identically outside the workspace tree.
 *
 * The one thing that does need workspace context is `ui.useFreezeGuard`, so this
 * file uses the documented non-React half instead: `services.workspace.frozen`
 * and `onFreezeChange`.
 *
 * Style note: a third-party plugin bundle is not scanned by Studio's Tailwind
 * build, so only utilities Studio itself already emits would have any effect.
 * Everything cosmetic here is therefore an inline style, deliberately.
 */

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
    type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { Eye, EyeOff, Timer } from "lucide-react";
import { definePlugin, ui, type PluginApp } from "narraleaf-studio/plugin";
import { MESSAGES } from "./i18n";
import { createProjectStore, type ProjectStore } from "./projectStore";
import {
    ENTITY,
    PLUGIN_ID,
    createMachineStore,
    readQueue,
    toCredentials,
    writeQueue,
    type MachineStore,
} from "./settings";
import { createTracker, type Tracker } from "./tracker";
import { fetchToday, type TodayTotal } from "./wakatime";

const ACTION_ID = `${PLUGIN_ID}.open`;
const API_KEY_URL = "https://wakatime.com/settings/api-key";

const LABEL_STYLE = { fontSize: "0.8125rem", fontWeight: 500 } as const;
const HINT_STYLE = { fontSize: "0.7rem", lineHeight: 1.5, opacity: 0.65, marginTop: "0.125rem" } as const;

type Translate = (key: string, params?: Record<string, string | number>) => string;

type Deps = {
    app: PluginApp;
    machine: MachineStore;
    project: ProjectStore;
    tracker: Tracker;
};

export default definePlugin({
    setup(app) {
        // Indirection, not laziness: the settings store's change hook has to be
        // able to reach the tracker, and the tracker has to be able to read the
        // settings store. A tracker parked on an auth failure should wake the
        // moment the key it objected to is replaced.
        const pending: { tracker: Tracker | null } = { tracker: null };

        const machine = createMachineStore(() => pending.tracker?.resume());
        const project = createProjectStore(app);

        const tracker = createTracker({
            readConfig: () => {
                const settings = machine.get();
                return {
                    ...toCredentials(settings.apiKey, app.manifest.version),
                    enabled: settings.enabled,
                    entity: ENTITY,
                    project: project.get().projectName,
                };
            },
            readQueue,
            writeQueue,
        });
        pending.tracker = tracker;
        const stopTracker = tracker.start();

        // Version control replaces the working tree under us; a store that kept
        // its pre-restore copy would write it back on the author's next edit.
        app.services.workspace.registerReloader(() => project.load());
        void project.load();

        // With no permanent UI, a rejected key would otherwise fail in total
        // silence until the author next opened the dialog. One toast per
        // transition into the failure — not per retry, which would be a stream.
        const translator = app.services.i18n.createTranslator(MESSAGES);
        let announced = false;
        const stopWatching = tracker.subscribe(() => {
            const paused = tracker.status().pausedForAuth;
            if (paused && !announced) {
                announced = true;
                app.services.ui.notifications.error(translator.t("notify.auth"));
            } else if (!paused) {
                announced = false;
            }
        });

        const dialog = createDialog({ app, machine, project, tracker });

        // Studio renders a group as a top-bar dropdown and a standalone action as
        // a single icon button beside Run. This is the second kind on purpose.
        const stopAction = app.services.ui.actions.register({
            id: ACTION_ID,
            icon: <Timer size={16} />,
            tooltip: "WakaTime",
            onClick: () => dialog.open(),
        });

        return () => {
            stopWatching();
            void stopAction();
            dialog.dispose();
            stopTracker();
        };
    },
});

/* ------------------------------------------------------------------ dialog */

type DialogController = {
    subscribe(listener: () => void): () => void;
    isOpen(): boolean;
    set(open: boolean): void;
};

function createDialog(deps: Deps): { open(): void; dispose(): void } {
    const container = document.createElement("div");
    container.dataset.plugin = PLUGIN_ID;
    document.body.appendChild(container);
    const root = createRoot(container);

    let open = false;
    const listeners = new Set<() => void>();
    const controller: DialogController = {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        isOpen: () => open,
        set(next) {
            open = next;
            for (const listener of listeners) {
                listener();
            }
        },
    };

    // Mounted once and left mounted, rendering nothing while closed. Mounting
    // per open would mean unmounting from inside the dialog's own click handler,
    // which React refuses to do synchronously.
    root.render(<SettingsDialog deps={deps} controller={controller} />);

    return {
        open: () => controller.set(true),
        dispose() {
            // Safe here, and only here: plugin cleanup runs outside rendering.
            root.unmount();
            container.remove();
        },
    };
}

function SettingsDialog({ deps, controller }: { deps: Deps; controller: DialogController }) {
    const isOpen = useSyncExternalStore(controller.subscribe, controller.isOpen);
    const t = useTranslate(deps.app);
    const close = useCallback(() => controller.set(false), [controller]);

    return (
        <ui.Modal isOpen={isOpen} onClose={close} title={t("dialog.title")} size="sm">
            {/* Modal renders null while closed, so the body's hooks — including the
                deferred commits, which flush on unmount — never run behind it. */}
            <DialogBody deps={deps} onClose={close} />
        </ui.Modal>
    );
}

function DialogBody({ deps, onClose }: { deps: Deps; onClose: () => void }) {
    const { app, machine, project, tracker } = deps;
    const t = useTranslate(app);
    const version = app.manifest.version;

    const settings = useSyncExternalStore(machine.subscribe, machine.get);
    const projectSettings = useSyncExternalStore(project.subscribe, project.get);
    const status = useSyncExternalStore(tracker.subscribe, tracker.status);
    const frozen = useFrozen(app);

    const [reveal, setReveal] = useState(false);
    const [today, setToday] = useState<TodayTotal | null>(null);
    const [testing, setTesting] = useState(false);
    const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

    const apiKey = settings.apiKey.trim();
    const credentials = useMemo(() => toCredentials(apiKey, version), [apiKey, version]);

    const apiKeyField = useDeferredCommit(settings.apiKey, value => machine.set({ apiKey: value }));
    const projectField = useDeferredCommit(
        projectSettings.projectName,
        value => void project.patch({ projectName: value }),
    );

    /* Today's total is read from the server rather than derived: the heartbeats
       this plugin sent are only part of it. Only while the dialog is open. */
    useEffect(() => {
        if (!credentials.apiKey) {
            setToday(null);
            return;
        }
        let cancelled = false;
        void (async () => {
            const result = await fetchToday(credentials);
            if (!cancelled && "text" in result) {
                setToday(result);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [credentials]);

    const runTest = useCallback(async () => {
        apiKeyField.flush();
        projectField.flush();
        setTesting(true);
        setMessage(null);
        // Record one first, so the button proves the *write* path — the half a
        // setup actually gets wrong. No-ops until the key and name are both in.
        await tracker.recordNow();
        // Read back through the store: the flushes above are what just wrote it,
        // and this closure predates them.
        const result = await fetchToday(toCredentials(machine.get().apiKey, version));
        if ("text" in result) {
            setToday(result);
            setMessage({ ok: true, text: t("test.ok", { total: result.text }) });
            tracker.resume();
        } else {
            setMessage({
                ok: false,
                text: result.kind === "auth" ? t("test.auth") : t("test.failed", { message: result.message }),
            });
        }
        setTesting(false);
    }, [apiKeyField, machine, projectField, t, tracker, version]);

    const state = !settings.enabled ? "disabled"
        : !apiKey ? "needsKey"
        : !projectSettings.projectName.trim() ? "needsProject"
        : status.pausedForAuth ? "pausedForAuth"
        : "tracking";
    const statusText = state !== "tracking"
        ? t(`status.${state}`)
        : today
            ? t("status.tracking", { total: today.text })
            : t("status.trackingUnknown");

    return (
        <ui.ModalBody>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                <Row
                    label={t("field.enabled")}
                    hint={t("field.enabledHint")}
                    control={(
                        <ui.Switch
                            checked={settings.enabled}
                            onCheckedChange={checked => machine.set({ enabled: checked })}
                        />
                    )}
                />

                <Field label={t("field.apiKey")} hint={<ApiKeyHint t={t} />}>
                    <ui.Input
                        size="sm"
                        fullWidth
                        autoFocus
                        type={reveal ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={t("field.apiKeyPlaceholder")}
                        value={apiKeyField.value}
                        onChange={event => apiKeyField.set(event.target.value)}
                        onBlur={apiKeyField.flush}
                        rightIcon={reveal ? <EyeOff size={14} /> : <Eye size={14} />}
                        rightIconLabel={reveal ? t("field.hide") : t("field.reveal")}
                        onRightIconClick={() => setReveal(current => !current)}
                    />
                </Field>

                <Field label={t("field.project")} hint={t("field.projectHint")}>
                    <ui.Input
                        size="sm"
                        fullWidth
                        placeholder={t("field.projectPlaceholder")}
                        value={projectField.value}
                        onChange={event => projectField.set(event.target.value)}
                        onBlur={projectField.flush}
                        disabled={frozen}
                        title={frozen ? t("status.frozen") : undefined}
                    />
                </Field>

                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.75rem",
                        paddingTop: "0.75rem",
                        borderTop: "1px solid var(--color-edge, rgba(127,127,127,0.25))",
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0, fontSize: "0.75rem", lineHeight: 1.4 }}>
                        <div style={{ opacity: 0.8 }}>{statusText}</div>
                        {status.queued > 0 && (
                            <div style={{ opacity: 0.55 }}>
                                {t("status.queued", { count: status.queued })}
                            </div>
                        )}
                        {message && (
                            <div style={{ opacity: message.ok ? 0.8 : 1, color: message.ok ? undefined : "var(--color-danger, #dc2626)" }}>
                                {message.text}
                            </div>
                        )}
                    </div>
                    <ui.Button size="sm" variant="secondary" disabled={testing || !apiKeyField.value.trim()} onClick={() => void runTest()}>
                        {testing ? t("action.testing") : t("action.test")}
                    </ui.Button>
                    <ui.Button size="sm" onClick={onClose}>{t("action.close")}</ui.Button>
                </div>
            </div>
        </ui.ModalBody>
    );
}

function Row({ label, hint, control }: { label: string; hint: string; control: ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={LABEL_STYLE}>{label}</div>
                <div style={HINT_STYLE}>{hint}</div>
            </div>
            <div style={{ paddingTop: "0.125rem" }}>{control}</div>
        </div>
    );
}

/**
 * Label above, control below, hint under that — written out rather than using
 * `ui.InputGroup` because its `helper` is typed `string`, and the API key's hint
 * has to carry an interactive element inside the sentence.
 */
function Field({ label, hint, children }: {
    label: string;
    hint: ReactNode;
    children: ReactNode;
}) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            <div style={LABEL_STYLE}>{label}</div>
            {children}
            <div style={HINT_STYLE}>{hint}</div>
        </div>
    );
}

/**
 * The API key hint, with the address inside it click-to-copy.
 *
 * Not a link, because a plugin cannot open one: the workspace window denies
 * every `setWindowOpenHandler` request and blocks `will-navigate` to anything
 * outside its own entry, and `shell.openExternal` lives behind an IPC the plugin
 * facade does not expose (it carries `fs`, `permissions` and `bash`, nothing
 * else). An `<a href>` here would be a control that visibly does nothing, which
 * is worse than plain text. Copying is the part the author actually needs.
 *
 * The address is spliced into the sentence rather than appended to it, so a
 * translation can put it where its own grammar wants it — `{url}` survives `t()`
 * untouched because no `url` param is passed.
 */
function ApiKeyHint({ t }: { t: Translate }) {
    const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
    const timer = useRef<number | null>(null);

    useEffect(() => () => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
        }
    }, []);

    const copy = useCallback(async () => {
        setState(await copyText(API_KEY_URL) ? "copied" : "failed");
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
        }
        timer.current = window.setTimeout(() => setState("idle"), 2500);
    }, []);

    const [before, after = ""] = t("field.apiKeyHint").split("{url}");

    return (
        <>
            {before}
            <button
                type="button"
                onClick={() => void copy()}
                title={t("field.copyLink")}
                style={{
                    // Opaque against the muted sentence around it, so it reads as
                    // the one thing on the line that answers to a click.
                    opacity: 1,
                    font: "inherit",
                    color: "inherit",
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                    textDecoration: "underline",
                    textUnderlineOffset: "0.2em",
                    wordBreak: "break-all",
                }}
            >
                {API_KEY_URL}
            </button>
            {after}
            {state !== "idle" && (
                <div style={{ opacity: 1, marginTop: "0.25rem", color: state === "failed" ? "var(--color-danger, #dc2626)" : undefined }}>
                    {t(state === "copied" ? "field.copied" : "field.copyFailed")}
                </div>
            )}
        </>
    );
}

/** Clipboard API first; the `execCommand` path is for a context that refuses it. */
async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        /* Fall through. */
    }
    try {
        const scratch = document.createElement("textarea");
        scratch.value = text;
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        const copied = document.execCommand("copy");
        scratch.remove();
        return copied;
    } catch {
        return false;
    }
}

/* ------------------------------------------------------------------- hooks */

function useTranslate(app: PluginApp): Translate {
    const translator = useMemo(() => app.services.i18n.createTranslator(MESSAGES), [app]);
    const subscribe = useCallback((listener: () => void) => {
        const cleanup = app.services.i18n.onLocaleChange(() => listener());
        return () => {
            void cleanup();
        };
    }, [app]);
    // Read for its re-render, not its value: the translator resolves against the
    // editor language at call time, so it only needs to be called again.
    useSyncExternalStore(subscribe, () => app.services.i18n.locale);
    return useCallback((key, params) => translator.t(key, params), [translator]);
}

/**
 * `ui.useFreezeGuard` needs the workspace React context this dialog's own root
 * does not have, so the freeze state comes from the service half instead.
 */
function useFrozen(app: PluginApp): boolean {
    const subscribe = useCallback((listener: () => void) => {
        const cleanup = app.services.workspace.onFreezeChange(() => listener());
        return () => {
            void cleanup();
        };
    }, [app]);
    return useSyncExternalStore(subscribe, () => app.services.workspace.frozen);
}

/**
 * A text field that keeps its own draft and commits behind it.
 *
 * Committing per keystroke would mean a project write — and a tracker wake-up —
 * per keystroke; committing only on blur would lose whatever was typed into a
 * dialog closed with Escape. So: debounce, flush on blur, and flush again on
 * unmount, which is what closing the dialog does to this component.
 */
function useDeferredCommit(external: string, commit: (value: string) => void) {
    const [value, setValue] = useState(external);
    const [dirty, setDirty] = useState(false);

    const commitRef = useRef(commit);
    commitRef.current = commit;
    const pending = useRef<string | null>(null);
    const timer = useRef<number | null>(null);

    // An external change (a reload after a version restore) wins over a draft
    // nobody is editing, and never over one somebody is.
    useEffect(() => {
        if (!dirty) {
            setValue(external);
        }
    }, [external, dirty]);

    const flush = useCallback(() => {
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        if (pending.current !== null) {
            const next = pending.current;
            pending.current = null;
            setDirty(false);
            commitRef.current(next);
        }
    }, []);

    const set = useCallback((next: string) => {
        setValue(next);
        setDirty(true);
        pending.current = next;
        if (timer.current !== null) {
            window.clearTimeout(timer.current);
        }
        timer.current = window.setTimeout(flush, 500);
    }, [flush]);

    useEffect(() => flush, [flush]);

    return { value, set, flush };
}
