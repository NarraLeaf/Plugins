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
 * **When to start measuring.** `gameStart` puts the probes in during `setup`, which is the only way
 * the boot is measurable at all; `graph` leaves the game untouched until a `Start Profiling` node
 * runs. Either way the plugin binds no keys and opens nothing by itself - showing the overlay is a
 * node, and an author who wants a chord binds one with an `On Key Down` head in their own global
 * blueprint. A plugin that claimed a key would be claiming it in someone else's game, ahead of that
 * game's own input routing.
 */

import { defineRuntimePlugin, type RuntimePluginEventMap } from "narraleaf-studio/runtime";
import { isStudioHostedGame, type EnvironmentScope } from "./environment";
import { createPerformanceNodes, inertBridge, type NodeBridge } from "./nodes";
import { PerformanceOverlay } from "./overlay";
import type { ProbeScope } from "./probes";
import { Profiler, type ProfilerHost } from "./profiler";
import { formatReportJson, formatReportText } from "./report";
import { normalizeSettings, SETTINGS_NAMESPACE } from "./settings";
import { stringsFor } from "./strings";

/** Kept in step with manifest.json; it is stamped into every report. */
const PLUGIN_VERSION = "0.2.0";

type BrowserScope = ProbeScope & EnvironmentScope & {
    navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
};

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
            // Absent unless the manifest asked for `diagnostics` and the shell can answer, which is
            // the same shape every other optional member here has: the profiler simply reports one
            // fewer thing rather than degrading.
            ...(app.game.diagnostics
                ? { readEngineCache: () => app.game.diagnostics?.imageCache() ?? null }
                : {}),
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
        if (settings.collectFrom === "gameStart") {
            profiler.start();
        }

        const bridge: NodeBridge = {
            startProfiling: () => profiler.startFresh(),
            stopProfiling: () => profiler.stop(),
            setView: view => profiler.setView(view),
            toggleHud: () => profiler.toggleHud(),
            toggleInspector: () => profiler.toggleInspector(),
            mark: label => profiler.mark("author", label),
            beginSpan: name => profiler.beginSpan(name),
            endSpan: name => profiler.endSpan(name),
            quick: () => profiler.quick(),
            capture: () => {
                const report = profiler.capture();
                return { summary: formatReportText(report), json: formatReportJson(report) };
            },
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
        // Numbered, not identified: the engine names a scene with a UUID, and a UUID on a surface
        // someone reads is not information. The report's `scenes` table keeps the ids for tools.
        const sceneEvent = (sceneId: string | null, verb: string): string => {
            const ordinal = profiler.sceneOrdinal(sceneId);
            return ordinal === null ? `scene ${verb}` : `scene ${ordinal} ${verb}`;
        };
        on("sceneEnter", payload => {
            profiler.count("scenesEntered");
            profiler.mark("engine", sceneEvent(payload.sceneId, "entered"));
        });
        on("sceneExit", payload => {
            profiler.mark("engine", sceneEvent(payload.sceneId, "left"));
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
