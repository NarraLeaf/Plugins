# Tagged Log

A blueprint node that composes a tagged log line and prints it.

Drop a **Tagged Log** node (category *Debug*) into any event or macro graph. Set:

- **Tag** — a short label, e.g. `save`.
- **Message parts** — a JSON array, e.g. `["slot", 3, true]`.

On execution it prints `[<tag>]: <parts joined by space>`, coercing every part with `String()`:

```
[save]: slot 3 true
```

The node runs in the editor preview and in shipped games — the definition is registered from both the `studio` and `runtime` entries out of one shared module (`src/nodes.ts`).

## Note on inputs

The message parts are a JSON inspector field rather than variadic data input pins (like the built-in Concat node). A plugin node reads its configuration from `ctx.params`; reading a wired data input pin needs a host accessor the plugin API does not expose yet. When it does, this node can grow real dynamic pins without changing its output.

## Build

```bash
yarn install
yarn build   # -> dist/
```

Built by the shared [authoring guide](https://narraleaf.com/docs/studio/plugin/create-first-plugin).
