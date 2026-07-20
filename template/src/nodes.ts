/**
 * Blueprint node definitions shared by both entries.
 *
 * This split is the recommended pattern: the studio entry registers the full
 * definition (palette metadata, pins, in-editor preview execution) while the
 * runtime entry registers the same objects for game execution environments,
 * where only `type` and `execute` are read. One definition, no drift.
 *
 * It only typechecks because `narraleaf-studio/plugin` and
 * `narraleaf-studio/runtime` share one set of declarations — a `BlueprintNodeDef`
 * is accepted where a `RuntimeBlueprintNodeDef` is expected.
 */

import type { BlueprintNodeDef } from "narraleaf-studio/plugin";

export const PLUGIN_ID = "example.starter";

export function createStarterNodes(): BlueprintNodeDef[] {
    return [
        {
            // Every contributed type must be prefixed with the plugin id and
            // listed in manifest.json contributes.blueprintNodes, or Studio
            // throws at load time.
            type: `${PLUGIN_ID}.log`,
            displayName: "Starter Log",
            category: "Plugin",
            keywords: ["log", "debug", "starter", "example"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            // Inspector params are the values a plugin node can read directly:
            // they arrive on `ctx.params`. Reading a *data input pin* instead
            // needs a host helper that the plugin API does not expose yet, so
            // stick to params until it does.
            inspectorParams: [
                { key: "message", label: "Message", kind: "string" },
            ],
            execute: ctx => {
                const message = ctx.params.message;
                console.log("[starter]", typeof message === "string" ? message : "(no message)");
                return { nextPort: "next" };
            },
        },
    ];
}
