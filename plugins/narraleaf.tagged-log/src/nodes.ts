/**
 * Blueprint node definitions shared by both entries (studio + runtime).
 *
 * The node composes a tagged log line — `[<tag>]: <parts joined by space>` —
 * from two inspector fields and prints it. Every value is coerced with
 * `String()`, so numbers, booleans, and objects all log cleanly.
 *
 * Why inspector params and not dynamic data input pins (like the built-in
 * Concat): a plugin node reads its configuration from `ctx.params`, populated by
 * its `inspectorParams`. Reading a wired *data input pin* needs a host resolver
 * that the plugin API does not expose yet, so `parts` is a JSON array field
 * instead of a variadic pin. When that accessor lands, this node can grow real
 * dynamic pins without changing its output.
 */

import type { BlueprintNodeDef } from "narraleaf-studio/plugin";

export const PLUGIN_ID = "narraleaf.tagged-log";

function composeTaggedLine(tag: unknown, parts: unknown): string {
    const label = typeof tag === "string" && tag.trim() ? tag.trim() : "log";
    const list = Array.isArray(parts) ? parts : parts == null ? [] : [parts];
    const message = list.map(part => String(part)).join(" ");
    return `[${label}]: ${message}`;
}

export function createTaggedLogNodes(): BlueprintNodeDef[] {
    return [
        {
            type: `${PLUGIN_ID}.print`,
            displayName: "Tagged Log",
            category: "Debug",
            keywords: ["log", "tag", "debug", "print", "console"],
            graphKinds: ["event", "macro"],
            isPure: false,
            pins: [
                { id: "in", kind: "input", semantic: "exec", label: "In" },
                { id: "next", kind: "output", semantic: "exec", label: "Next" },
            ],
            inspectorParams: [
                { key: "tag", label: "Tag", kind: "string" },
                // A JSON array, e.g. ["loaded", 3, true] -> "loaded 3 true".
                { key: "parts", label: "Message parts", kind: "json" },
            ],
            execute: ctx => {
                console.log(composeTaggedLine(ctx.params.tag, ctx.params.parts));
                return { nextPort: "next" };
            },
        },
    ];
}
