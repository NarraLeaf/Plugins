/**
 * Blueprint node definitions shared by both entries.
 *
 * This split is the recommended pattern: the studio entry registers the full
 * definition (palette metadata, pins, in-editor preview execution) while the
 * runtime entry registers the same objects for game execution environments,
 * where only `type` and `execute` are read. One definition, no drift.
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
                {
                    id: "message",
                    kind: "input",
                    semantic: "data",
                    valueType: "string",
                    label: "Message",
                    allowInlineLiteral: true,
                },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            execute: ctx => {
                const message = ctx.inputValues?.message;
                console.log("[starter]", typeof message === "string" ? message : "(no message)");
                return { nextPort: "next" };
            },
        },
    ];
}
