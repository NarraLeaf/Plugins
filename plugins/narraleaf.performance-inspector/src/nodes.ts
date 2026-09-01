/**
 * The blueprint nodes, defined once and registered by both entries.
 *
 * They are the *only* way the profiler is turned on and shown. The plugin binds no keys: an author
 * who wants a chord puts an `On Key Down` head in the game's global blueprint - it takes any binding
 * the project's own input vocabulary can spell - and wires it here. A plugin claiming a key in
 * someone else's game, ahead of that game's own input routing, is not the plugin's call to make.
 *
 * So a story can start measuring at the top of a chapter, open the display, bracket a scene it
 * suspects, and read the frame rate back to decide whether to run the expensive version of an
 * effect - all of it in the shipped build, which is the only build whose numbers are the real ones.
 *
 * The bridge argument is why this module imports neither the profiler nor React: the editor
 * registers the same definitions to get their palette entries and inspector shape, and in the editor
 * there is no profiler to talk to. {@link inertBridge} is what it passes, and every node degrades to
 * a no-op that still leaves through its exec pin rather than throwing into an author's preview.
 */

import type { PluginBlueprintNodeContext, PluginBlueprintNodeDef } from "narraleaf-studio/plugin";
import type { QuickStats } from "./collector";
import { PLUGIN_ID, OVERLAY_VIEWS, type OverlayView } from "./settings";

const CATEGORY = "Performance";

const PARAM_VIEW = "view";
const PARAM_LABEL = "label";
const PARAM_NAME = "name";
const PIN_LABEL = "labelIn";
const PIN_NAME = "nameIn";

const execIn = { id: "in", kind: "input", semantic: "exec", label: "In" } as const;
const execNext = { id: "next", kind: "output", semantic: "exec", label: "Next" } as const;

/**
 * What a node can ask of a running profiler.
 *
 * Deliberately not the {@link import("./profiler").Profiler} itself. A node runs in two places with
 * two very different sets of things in reach, and naming the small overlap keeps the editor half
 * from importing an overlay it will never draw.
 */
export type NodeBridge = {
    /** Arm the probes and measure from here. Throws away whatever window was already open. */
    startProfiling(): void;
    /** Take the probes back out. What was collected stays readable. */
    stopProfiling(): void;
    setView(view: OverlayView): void;
    mark(label: string): void;
    beginSpan(name: string): void;
    /** Milliseconds, or null when nothing had opened that span. */
    endSpan(name: string): number | null;
    /** Null where no profiler is running, which is every execution inside the editor. */
    quick(): QuickStats | null;
    capture(): { summary: string; json: string } | null;
};

/** The bridge the editor registers with: every node still runs, and nothing happens. */
export const inertBridge: NodeBridge = {
    startProfiling: () => undefined,
    stopProfiling: () => undefined,
    setView: () => undefined,
    mark: () => undefined,
    beginSpan: () => undefined,
    endSpan: () => null,
    quick: () => null,
    capture: () => null,
};

type ExecuteCtx = PluginBlueprintNodeContext;

function readString(value: unknown, fallback = ""): string {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return fallback;
}

/** A wired pin wins over the inspector field, so a loop can name what it is measuring. */
function resolveText(ctx: ExecuteCtx, pinId: string, paramKey: string): string {
    return readString(ctx.resolveInput?.(pinId)) || readString(ctx.params[paramKey]);
}

const MEGABYTE = 1024 * 1024;

function megabytes(bytes: number): number {
    return Math.round((bytes / MEGABYTE) * 100) / 100;
}

/**
 * The numbers `Get Performance Stats` publishes when no profiler is running.
 *
 * Zeroes rather than a thrown error, because the graph that reads them is usually deciding how much
 * work to do - and a preview in the editor should take the cheap branch quietly rather than fail.
 */
const NO_STATS = {
    fps: 0,
    frameMs: 0,
    hitches: 0,
    stalls: 0,
    heapMB: 0,
    heldMB: 0,
    assetCount: 0,
    assetMB: 0,
    running: false,
};

export function createPerformanceNodes(bridge: NodeBridge): PluginBlueprintNodeDef[] {
    return [
        {
            type: `${PLUGIN_ID}.startProfiling`,
            displayName: "Start Profiling",
            category: CATEGORY,
            keywords: ["performance", "profile", "start", "begin", "measure", "record"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [execIn, execNext],
            // Also the way to bound a measurement: run it at the top of the chapter you suspect and
            // everything before it is dropped, so the report describes that chapter and not the run.
            execute: () => {
                bridge.startProfiling();
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.stopProfiling`,
            displayName: "Stop Profiling",
            category: CATEGORY,
            keywords: ["performance", "profile", "stop", "end", "pause"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [execIn, execNext],
            // The probes come out and the game is untouched again. What was measured stays readable,
            // because someone who stopped a profile stopped it in order to read the result.
            execute: () => {
                bridge.stopProfiling();
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.setOverlay`,
            displayName: "Set Performance Overlay",
            category: CATEGORY,
            keywords: ["performance", "overlay", "hud", "fps", "profiler", "debug"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [execIn, execNext],
            inspectorParams: [
                {
                    key: PARAM_VIEW,
                    label: "Show",
                    kind: "select",
                    options: [
                        { value: "hidden", label: "Hidden" },
                        { value: "hud", label: "Compact display" },
                        { value: "inspector", label: "Full panel" },
                    ],
                },
            ],
            execute: ctx => {
                const requested = readString(ctx.params[PARAM_VIEW], "hud");
                const view = (OVERLAY_VIEWS as readonly string[]).includes(requested)
                    ? (requested as OverlayView)
                    : "hud";
                bridge.setView(view);
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.mark`,
            displayName: "Mark Performance Event",
            category: CATEGORY,
            keywords: ["performance", "mark", "timeline", "annotate", "profiler"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                {
                    id: PIN_LABEL,
                    kind: "input",
                    semantic: "data",
                    valueType: "string",
                    label: "Label",
                    optional: true,
                    allowInlineLiteral: true,
                },
                execNext,
            ],
            inspectorParams: [{ key: PARAM_LABEL, label: "Label", kind: "string" }],
            execute: ctx => {
                const label = resolveText(ctx, PIN_LABEL, PARAM_LABEL);
                if (label) {
                    bridge.mark(label);
                }
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.beginSpan`,
            displayName: "Begin Performance Span",
            category: CATEGORY,
            keywords: ["performance", "span", "begin", "measure", "profiler"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                {
                    id: PIN_NAME,
                    kind: "input",
                    semantic: "data",
                    valueType: "string",
                    label: "Name",
                    optional: true,
                    allowInlineLiteral: true,
                },
                execNext,
            ],
            inspectorParams: [{ key: PARAM_NAME, label: "Name", kind: "string" }],
            execute: ctx => {
                const name = resolveText(ctx, PIN_NAME, PARAM_NAME);
                if (name) {
                    bridge.beginSpan(name);
                }
                return { nextPort: "next" };
            },
        },
        {
            type: `${PLUGIN_ID}.endSpan`,
            displayName: "End Performance Span",
            category: CATEGORY,
            keywords: ["performance", "span", "end", "measure", "profiler"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                {
                    id: PIN_NAME,
                    kind: "input",
                    semantic: "data",
                    valueType: "string",
                    label: "Name",
                    optional: true,
                    allowInlineLiteral: true,
                },
                execNext,
                { id: "durationMs", kind: "output", semantic: "data", valueType: "float", label: "Duration (ms)" },
            ],
            inspectorParams: [{ key: PARAM_NAME, label: "Name", kind: "string" }],
            execute: ctx => {
                const name = resolveText(ctx, PIN_NAME, PARAM_NAME);
                const durationMs = name ? bridge.endSpan(name) : null;
                return { nextPort: "next", outputValues: { durationMs: durationMs ?? 0 } };
            },
        },
        {
            type: `${PLUGIN_ID}.getStats`,
            displayName: "Get Performance Stats",
            category: CATEGORY,
            keywords: ["performance", "fps", "frame", "memory", "heap", "quality", "profiler"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                execNext,
                { id: "fps", kind: "output", semantic: "data", valueType: "float", label: "FPS" },
                { id: "frameMs", kind: "output", semantic: "data", valueType: "float", label: "Frame (ms)" },
                { id: "hitches", kind: "output", semantic: "data", valueType: "integer", label: "Hitches" },
                { id: "stalls", kind: "output", semantic: "data", valueType: "integer", label: "Stalls" },
                { id: "heapMB", kind: "output", semantic: "data", valueType: "float", label: "Heap (MB)" },
                { id: "heldMB", kind: "output", semantic: "data", valueType: "float", label: "Held (MB)" },
                { id: "assetCount", kind: "output", semantic: "data", valueType: "integer", label: "Assets" },
                { id: "assetMB", kind: "output", semantic: "data", valueType: "float", label: "Loaded (MB)" },
                { id: "running", kind: "output", semantic: "data", valueType: "boolean", label: "Measuring" },
            ],
            // The node an author reaches for to scale an effect down on a weak machine: read the
            // frame rate, branch, and skip the expensive version. See NO_STATS for what it answers
            // where nothing is measuring.
            execute: () => {
                const stats = bridge.quick();
                if (!stats) {
                    return { nextPort: "next", outputValues: { ...NO_STATS } };
                }
                return {
                    nextPort: "next",
                    outputValues: {
                        fps: stats.fps,
                        frameMs: stats.frameMs,
                        hitches: stats.hitches,
                        stalls: stats.stalls,
                        heapMB: megabytes(stats.heapUsedBytes),
                        heldMB: megabytes(stats.retainedBytes),
                        assetCount: stats.addresses,
                        assetMB: megabytes(stats.bytes),
                        running: true,
                    },
                };
            },
        },
        {
            type: `${PLUGIN_ID}.capture`,
            displayName: "Capture Performance Report",
            category: CATEGORY,
            keywords: ["performance", "report", "capture", "snapshot", "profiler", "diagnostics"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                execIn,
                execNext,
                { id: "summary", kind: "output", semantic: "data", valueType: "string", label: "Summary" },
                { id: "json", kind: "output", semantic: "data", valueType: "string", label: "JSON" },
            ],
            // Also writes the report to the game log and to plugin storage; see Profiler.capture.
            // That is what lets a build in someone else's hands produce a report at all.
            execute: () => {
                const captured = bridge.capture();
                return {
                    nextPort: "next",
                    outputValues: {
                        summary: captured?.summary ?? "",
                        json: captured?.json ?? "",
                    },
                };
            },
        },
    ];
}
