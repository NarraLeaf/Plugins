# Writing a NarraLeaf Studio plugin

A complete guide to building, testing and shipping a plugin.

[简体中文](authoring.zh-CN.md) · [Back to the registry](../README.md)

---

## Contents

- [What a plugin is](#what-a-plugin-is)
- [The two entries](#the-two-entries)
- [Project layout](#project-layout)
- [The manifest](#the-manifest)
- [Types](#types)
- [Building](#building)
- [The studio API](#the-studio-api)
- [The runtime API](#the-runtime-api)
- [Blueprint nodes](#blueprint-nodes)
- [Widgets](#widgets)
- [Permissions](#permissions)
- [Testing in Studio](#testing-in-studio)
- [Publishing to this registry](#publishing-to-this-registry)
- [Known limits](#known-limits)

---

## What a plugin is

A plugin is a **directory** containing a `manifest.json` and one or two
prebundled ESM files. Studio installs it by copying that directory into
`userData/plugins/<plugin-id>`, then serves the entry files over an internal
`app://` protocol.

There is no plugin store, no remote feed, and no auto-update. Distribution is
this registry: you publish a zip, users unzip it and point Studio at the folder.

Three consequences worth internalising up front:

- **Your entries must be prebundled.** Studio does not resolve bare imports from
  your plugin, install your dependencies, or run a build for you. Whatever you
  ship must already be a single self-contained ESM file per entry.
- **Plugins are not sandboxed.** An installed plugin runs with real privileges.
  Studio shows the user your `permissions` at install time, and that is the
  entire security boundary.
- **Everything you register must be declared** in the manifest. Studio validates
  a project's blueprint graphs without executing plugin code, so it has to know
  your node and widget types from the manifest alone.

---

## The two entries

A plugin targets the editor, the game, or both.

| | `studio` entry | `runtime` entry |
| --- | --- | --- |
| Runs in | The editor | The game — Dev Mode, Preview, Production builds |
| Receives | `app.services` (curated whitelist) and `app.privileged` | `app.game` only |
| Can do | Panels, actions, editors, keybindings, notifications, storage, assets, story actions, blueprint nodes, widgets | Blueprint node `execute`, widget `render`, `log` |
| Lifecycle | Loaded on workspace open, unloaded on disable/uninstall | Loaded once per process, never unloaded |
| React | Available (`react`, `react-dom`, `react-dom/client`) | Available (no `react-dom/client`) |

The two are **physically isolated**. Importing `narraleaf-studio/plugin` from a
runtime entry throws — the game host does not have Studio's services, and the
error says so rather than handing you a broken object.

Which do you need?

- Editor-only tooling (a panel, an asset workflow, a story action) → `studio`.
- A blueprint node or widget that must work in a shipped game → **both**.
- Pure game behaviour with no editor presence → `runtime`.

If a blueprint node appears in the editor palette but has no runtime binding, it
works while authoring and does nothing in a shipped build. That is the single
most common plugin bug. Register from both entries.

---

## Project layout

Start from the template:

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin
corepack enable && yarn install && yarn build
```

```
plugins/yourname.your-plugin/
  manifest.json      what Studio reads at install time
  package.json       npm metadata + registry metadata under "narraleaf"
  yarn.lock          committed — each plugin resolves independently
  tsconfig.json
  build.mjs          bundles each declared entry into dist/
  src/
    main.ts          studio entry
    runtime.ts       runtime entry
    nodes.ts         shared definitions, imported by both
  dist/              build output — this is what ships
```

Each plugin directory is a **standalone package** with its own `node_modules`,
lockfile and pinned toolchain. There is no workspace and no hoisting, so two
contributors working on two plugins never share a dependency tree.

---

## The manifest

```json
{
  "manifestVersion": 2,
  "id": "yourname.your-plugin",
  "name": "Your Plugin",
  "version": "1.0.0",
  "description": "One sentence, shown in Studio.",
  "publisher": "Your Name",
  "entries": {
    "studio": "main.js",
    "runtime": "runtime.js"
  },
  "contributes": {
    "blueprintNodes": ["yourname.your-plugin.do-thing"],
    "widgets": []
  },
  "permissions": []
}
```

| Field | Rule |
| --- | --- |
| `manifestVersion` | Exactly `2`. v1 is hard-rejected. |
| `id` | `publisher.plugin-name`, lowercase, `/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/`. The directory must be named after it. |
| `name` | Display name. Required, non-empty. |
| `version` | Semver `x.y.z`, optional prerelease/build. Must equal `package.json` version. |
| `entries` | At least one of `studio` / `runtime`. Relative paths inside the package — no absolute paths, no `..`. |
| `contributes` | Only `blueprintNodes` and `widgets`. Every type prefixed with your plugin id. |
| `permissions` | See [Permissions](#permissions). Defaults to `[]`. |

`contributes` is not documentation — it is enforced. Registering a type that is
not declared throws at load, and every declared type must start with
`<your-plugin-id>.`. This is what lets Studio open a project and report "this
graph needs a node from a plugin you do not have" without running your code.

---

## Types

Install the types package:

```bash
yarn add -D narraleaf-studio
```

It is **types only** — the implementation comes from Studio at load time. The
declarations are generated from Studio's source, so they match the running host
rather than someone's notes about it.

```ts
import { definePlugin } from "narraleaf-studio/plugin";
import { defineRuntimePlugin } from "narraleaf-studio/runtime";
```

Both specifiers share one underlying set of declarations, which is what makes
the shared-definition pattern below typecheck: a `BlueprintNodeDef` from
`/plugin` is accepted where `/runtime` wants a `RuntimeBlueprintNodeDef`.

---

## Building

Your entries must be **prebundled ESM** with the host modules left external:

```js
external: [
    "narraleaf-studio/plugin",
    "narraleaf-studio/runtime",
    "react",
    "react-dom",
    "react-dom/client",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
]
```

This is not optional. Studio resolves those specifiers through an import map and
supplies the host's own React. Bundling React gives your plugin a second React
instance, and hooks fail in ways that look like anything except the real cause.
If you bundle `narraleaf-studio/*` instead of externalising it, the types
package's stub throws at import with a message telling you exactly this.

The template's `build.mjs` handles all of it: it reads `manifest.json`, maps each
declared entry (`main.js`) onto its source (`src/main.ts`), bundles, and copies
the manifest into `dist/`. You should not need to edit it.

```bash
yarn build       # bundle to dist/
yarn dev         # unminified, with sourcemaps
yarn typecheck   # tsc --noEmit
```

---

## The studio API

```ts
import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
    setup(app) {
        // app.plugin     — { pluginId, version }
        // app.manifest   — your normalized manifest
        // app.services   — the curated API surface
        // app.privileged — fs/bash, gated by manifest permissions

        return () => {
            // optional cleanup
        };
    },
});
```

`setup` may be async and may return a cleanup function. You rarely need one:
everything registered through `app.services` is tracked by the host and reclaimed
on unload, even if `setup` throws partway through. Return a cleanup only for
resources the host does not own — your own timers, listeners, or open handles.

`app.services` is deliberately a whitelist. Plugins do **not** get the workspace
service registry.

| Service | What it does |
| --- | --- |
| `storage` | `readJson(ns)` / `writeJson(ns, data)` — per-plugin persisted JSON |
| `assets` | `getMap`, `list`, `get`, `fetch`, `createObjectUrl`, `revokeObjectUrl` |
| `ui.panels` | `register` / `unregister` a workspace panel |
| `ui.actions` | `register` / `unregister`, plus action groups |
| `ui.editors` | `open` / `close` editor tabs |
| `ui.keybindings` | `register` / `registerMany`, returns a cleanup |
| `ui.notifications` | `info` / `success` / `warning` / `error` |
| `widgets` | `register`, `registerMany`, `get`, `list`, `has` |
| `story.actions` | `register` a scene-editor palette action that creates story blocks |
| `blueprintNodes` | `register`, `registerMany`, dynamic select option sources |

`ui` (imported from `narraleaf-studio/plugin`) is a prebuilt component kit —
buttons, inputs, modals, panel primitives — so plugin UI matches Studio's chrome
instead of approximating it.

Story actions are worth calling out: the blocks they create are **standard story
blocks**. Once created, the document does not depend on your plugin. Uninstalling
the plugin does not corrupt the story.

---

## The runtime API

```ts
import { defineRuntimePlugin } from "narraleaf-studio/runtime";

export default defineRuntimePlugin({
    setup(app) {
        app.game.blueprintNodes.registerMany(myNodes());
        app.game.log("info", "ready");
    },
});
```

That is the whole surface: `blueprintNodes.register/registerMany`,
`widgets.register/registerMany`, and `log(level, message)`. No services, no
privileged facade, no cleanup — game environments load once per process.

---

## Blueprint nodes

Define nodes in a shared module and register them from both entries:

```ts
// src/nodes.ts
import type { BlueprintNodeDef } from "narraleaf-studio/plugin";

export const PLUGIN_ID = "yourname.your-plugin";

export function createNodes(): BlueprintNodeDef[] {
    return [{
        type: `${PLUGIN_ID}.do-thing`,   // must be declared in contributes
        displayName: "Do Thing",
        category: "Plugin",
        keywords: ["thing", "example"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            { key: "message", label: "Message", kind: "string" },
        ],
        execute: ctx => {
            console.log(ctx.params.message);
            return { nextPort: "next" };
        },
    }];
}
```

```ts
// src/main.ts        app.services.blueprintNodes.registerMany(createNodes());
// src/runtime.ts     app.game.blueprintNodes.registerMany(createNodes());
```

The runtime side only reads `type` and `execute`; the extra editor fields are
ignored. One definition, no drift.

### Pins

| Field | Meaning |
| --- | --- |
| `kind` | `"input"` or `"output"` |
| `semantic` | `"exec"` for control flow, `"data"` for values |
| `valueType` | Loose tag for data pins: `string`, `boolean`, `integer`, `float`, `json` |
| `optional` | Input renders inactive until wired |
| `allowInlineLiteral` | Data input can be typed directly on the node card |

`execute` returns `{ nextPort }` to continue down an exec output, and
`{ outputValues }` to supply data outputs. Returning `{ nextPort: undefined }`
ends that branch.

### Reading input values

`ctx.params` holds your `inspectorParams` values and is the supported way for a
plugin node to read configuration.

**Reading a *data input pin* is not currently possible from a plugin.** Built-in
nodes use an internal host helper that the plugin API does not export yet. Until
it does, model configurable values as `inspectorParams`. If you need pin-driven
input, open an issue — this is a known gap, not an intended restriction.

### Flags

- `isPure: true` — no side effects. Pure nodes are evaluated as a value graph.
- `isLatent: true` — asynchronous. Disallowed in function graphs.
- `graphKinds` — where the node may appear: `"event"`, `"macro"`, `"function"`.

---

## Widgets

Widgets are custom UI element types usable in the UI editor. Register the module
from the studio entry and the renderer from the runtime entry:

```ts
// studio
app.services.widgets.registerMany(myWidgets());
// runtime
app.game.widgets.registerMany([{ type: `${PLUGIN_ID}.badge`, render: renderBadge }]);
```

As with nodes, every widget `type` must be prefixed with your plugin id and
listed in `contributes.widgets`.

---

## Permissions

```json
"permissions": [
  { "kind": "filesystem", "path": "/some/path", "mode": "readwrite", "recursive": true },
  { "kind": "api", "capability": "bash" }
]
```

| Kind | Fields |
| --- | --- |
| `filesystem` | `path`, `mode` (`read` / `write` / `readwrite`), `recursive` (required boolean) |
| `api` | `capability` |

Permissions gate `app.privileged`, which is enforced in the main process per
plugin — the renderer cannot widen its own grant. They apply to the **studio
entry only**; the runtime entry has no privileged facade at all.

Request the minimum. Users see this list at install time, and in this registry
every permission needs a stated reason in the pull request.

---

## Testing in Studio

```bash
# from the registry root
node scripts/package-plugin.mjs yourname.your-plugin
```

Unzip the archive from `.out/`, then in Studio open
**Launcher → Plugins → Install from folder** and select the unzipped folder.

Iterating: rebuild, reinstall over the same folder, and reopen the workspace.
The studio entry unloads and reloads; the runtime entry only reloads with the
game process, so restart Dev Mode when changing runtime code.

If a plugin fails to load, Studio isolates the failure and reports it against
that plugin with `status: "error"` rather than taking down the workspace. Check
the plugin's entry in the Plugins tab for the message.

---

## Publishing to this registry

1. Branch from `develop`.
2. Add your plugin under `plugins/<your-plugin-id>/`.
3. Validate and regenerate the index:

   ```bash
   node scripts/validate.mjs <your-plugin-id>
   node scripts/generate-index.mjs
   ```

4. Commit `yarn.lock` and the regenerated `index.json`, then open a pull request
   against `develop`.

`validate.mjs` runs a port of Studio's own manifest validator, so a plugin that
passes here is one Studio accepts at install time.

Maintainers release by pushing a `<plugin-id>@<version>` tag from `master`; CI
builds, packages and attaches the zip to a GitHub Release. See
[CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Known limits

Current as of manifest v2:

- No plugin store, remote feed, or auto-update — install is local-directory only.
- No inter-plugin dependencies and no load ordering.
- No sandbox. An installed plugin is trusted code.
- No `studioVersion` enforcement. The field exists in registry metadata and is
  advisory; Studio does not check it at install.
- Plugin nodes cannot read data input pins (see
  [Reading input values](#reading-input-values)).
- The runtime entry has no unload lifecycle.
