/**
 * Runtime entry: the profiler as it exists inside a running game - Dev Mode, a preview, a packaged
 * build or the web export.
 *
 * Two decisions are made here and nowhere else.
 *
 * **Whether to arm at all.** The author's `availability` setting is the whole answer: `studio` means
 * Dev Mode only, and a build made without changing it cannot show a player a debug overlay whatever
 * they press. When the profiler is not armed the blueprint nodes are still registered - against an
 * inert bridge - because a graph that calls `Mark Performance Event` must not break in the build
 * where measuring is off.
 *
 * **What one keystroke means.** The configured chord shows the compact display; the same chord with
 * Shift opens the full panel. The listener stands down while the player is typing and while an input
 * method is composing, which is the same rule the game's own keys follow.
 */

import { defineRuntimePlugin, type RuntimePluginEventMap } from "narraleaf-studio/runtime";
import { isStudioHostedGame, type EnvironmentScope } from "./environment";
import { chordHasShiftVariant, matchesChord, parseChord, type Chord } from "./hotkey";
import { createPerformanceNodes, inertBridge, type NodeBridge } from "./nodes";
import { PerformanceOverlay } from "./overlay";
import type { ProbeScope } from "./probes";
import { Profiler, type ProfilerHost } from "./profiler";
import { formatReportJson, formatReportText } from "./report";
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_NAMESPACE } from "./settings";
import { stringsFor } from "./strings";

/** Kept in step with manifest.json; it is stamped into every report. */
const PLUGIN_VERSION = "0.1.0";

type BrowserScope = ProbeScope & EnvironmentScope & {
    addEventListener?: (type: string, listener: (event: KeyboardEvent) => void, options?: unknown) => void;
    removeEventListener?: (type: string, listener: (event: KeyboardEvent) => void, options?: unknown) => void;
    navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
};

/**
 * Whether a keystroke belongs to something the player is typing into.
 *
 * The same guard the game's own keys use. Without it the profiler's chord fires inside a name-entry
 * field, and with an input method open every keystroke arrives twice - once as composition and once
 * as the committed key - so `isComposing` has to be honoured rather than assumed absent.
 */
function isTypingTarget(event: KeyboardEvent): boolean {
    if (event.isComposing || event.keyCode === 229) {
        return true;
    }
    const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
    if (!target) {
        return false;
    }
    if (target.isContentEditable) {
        return true;
    }
    const tag = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function shortened(text: string, limit = 48): string {
    const trimmed = text.trim();
    return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed;
}

export default defineRuntimePlugin({
    setup(app) {
        const scope = globalThis as unknown as BrowserScope;
        const settings = normalizeSettings(app.game.data.readJson(SETTINGS_NAMESPACE));
        const armed = settings.availability === "everywhere" || isStudioHostedGame(scope);

        if (!armed) {
            // Registered anyway: a story that marks its own spans has to keep running in the build
            // where nothing is measuring them.
            app.game.blueprintNodes.registerMany(createPerformanceNodes(inertBridge));
            app.game.log(
                "info",
                "Performance Inspector is not armed in this build. Set it to run everywhere in the "
                + "Performance panel in Studio if you want to profile a real build.",
            );
            return;
        }

        const host: ProfilerHost = {
            log: (level, message) => app.game.log(level, message),
            readLocale: () => app.game.locale?.current,
        };
        const store = app.game.store;
        if (store) {
            host.persist = (key, value) => {
                // Fire and forget on purpose: a report that could not be written is not a reason to
                // interrupt whoever asked for it, and the copy they asked for is unaffected.
                void store.set(key, value).catch(() => undefined);
            };
        }
        const clipboard = scope.navigator?.clipboard;
        const writeText = clipboard?.writeText;
        if (clipboard && typeof writeText === "function") {
            host.writeClipboard = text => writeText.call(clipboard, text);
        }

        const profiler = new Profiler({
            settings,
            scope,
            host,
            pluginVersion: PLUGIN_VERSION,
            now: () => (scope.performance ? scope.performance.now() : 0),
            epochNow: () => Date.now(),
        });
        profiler.start();

        const bridge: NodeBridge = {
            setView: view => profiler.setView(view),
            mark: label => profiler.mark("author", label),
            beginSpan: name => profiler.beginSpan(name),
            endSpan: name => profiler.endSpan(name),
            quick: () => profiler.quick(),
            capture: () => {
                const report = profiler.capture();
                return { summary: formatReportText(report), json: formatReportJson(report) };
            },
            reset: () => profiler.reset(),
        };
        app.game.blueprintNodes.registerMany(createPerformanceNodes(bridge));

        if (app.game.ui?.overlay) {
            app.game.ui.overlay.mount(() => (
                <PerformanceOverlay
                    profiler={profiler}
                    readStrings={() => stringsFor(app.game.locale?.current)}
                />
            ));
        } else {
            app.game.log("warning", "Performance Inspector could not draw its overlay in this environment.");
        }

        const chord: Chord = parseChord(settings.hotkey) ?? parseChord(DEFAULT_SETTINGS.hotkey)!;
        const canShift = chordHasShiftVariant(chord);
        const onKeyDown = (event: KeyboardEvent): void => {
            if (isTypingTarget(event)) {
                return;
            }
            if (canShift && matchesChord(chord, event, true)) {
                event.preventDefault();
                event.stopPropagation();
                profiler.toggleInspector();
                return;
            }
            if (matchesChord(chord, event)) {
                event.preventDefault();
                event.stopPropagation();
                profiler.toggleHud();
                return;
            }
            if (event.key === "Escape" && profiler.getView() === "inspector") {
                // Only while the panel is up, and consumed so the same press does not also open the
                // game's own menu behind it.
                event.preventDefault();
                event.stopPropagation();
                profiler.setView("hidden");
            }
        };
        // Capture phase: the game binds the same keys on the window, and a profiler that only sees
        // what the game did not want is not much of a profiler.
        scope.addEventListener?.("keydown", onKeyDown, true);

        const events = app.game.events;
        if (!events) {
            return;
        }
        /**
         * Subscribe only where the environment can actually fire it.
         *
         * `available` is not decoration: the web export has no window to close and an older host may
         * not produce an event this build knows about, and a listener that never fires is a bug that
         * only shows up on one target.
         */
        const on = <K extends keyof RuntimePluginEventMap>(
            name: K,
            listener: (payload: RuntimePluginEventMap[K]) => void,
        ): void => {
            if (events.available(name)) {
                events.on(name, listener);
            }
        };

        on("preloadComplete", () => profiler.mark("boot", "preload complete"));
        on("firstSceneReady", () => profiler.mark("boot", "first scene ready"));
        on("sceneEnter", payload => {
            profiler.count("scenesEntered");
            profiler.mark("engine", "scene enter", payload.sceneId ?? undefined);
        });
        on("sceneExit", payload => {
            profiler.mark("engine", "scene exit", payload.sceneId ?? undefined);
        });
        // Counted rather than marked: a playthrough produces thousands of these, and a timeline that
        // is one line per line of dialogue is a timeline nobody can read.
        on("dialogueEnd", () => profiler.count("dialogueLines"));
        on("choiceMade", payload => {
            profiler.count("choices");
            profiler.mark("story", "choice", shortened(payload.text ?? ""));
        });
        on("gameEnd", () => profiler.mark("story", "game end"));
        on("saveWritten", payload => {
            profiler.count("savesWritten");
            profiler.mark("story", "save written", payload.id);
        });
        on("beforeRestore", () => profiler.mark("story", "restore started"));
        on("afterRestore", () => {
            profiler.count("restores");
            profiler.mark("story", "restore finished");
        });
        on("fullscreenChanged", payload => {
            profiler.mark("engine", payload ? "entered fullscreen" : "left fullscreen");
        });
    },
});
