# Starter Plugin

A minimal NarraLeaf Studio plugin: one blueprint node, registered on both the
studio and runtime targets from a single shared definition.

Copy this directory to begin:

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin
corepack enable && yarn install && yarn build
```

## Then change

1. **`manifest.json`** — `id` (must be `publisher.plugin-name` and must match the
   directory name), `name`, `version`, `description`, `publisher`, and every
   type you contribute under `contributes`.
2. **`package.json`** — `name`, `version` (must match `manifest.json`),
   `description`, `license`, `keywords`, and `narraleaf.categories`.
3. **`src/nodes.ts`** — replace `PLUGIN_ID` and the node definition. Every
   contributed type must be prefixed with your plugin id *and* listed in
   `manifest.json`, or Studio throws at load.

Drop `src/runtime.ts` and the `runtime` entry from `manifest.json` if your
plugin only adds editor tooling. Drop `src/main.ts` and the `studio` entry if it
only adds game behaviour.

## Files

| File                            | Purpose                                                           |
| ------------------------------- | ----------------------------------------------------------------- |
| `manifest.json`                 | What Studio reads at install time.                                |
| `build.mjs`                     | Bundles each declared entry into `dist/`, host modules external.  |
| `src/main.ts`                   | Studio entry — runs in the editor, has an unload lifecycle.       |
| `src/runtime.ts`                | Runtime entry — runs in the game, no unload lifecycle.            |
| `src/nodes.ts`                  | Shared node definitions, so the two entries cannot drift.         |
| `types/narraleaf-studio.d.ts`   | Ambient types for the host modules. See the note in that file.    |

## Scripts

```bash
yarn build       # bundle to dist/
yarn dev         # same, unminified with sourcemaps
yarn typecheck   # tsc --noEmit
```

## Testing in Studio

From the repository root:

```bash
node scripts/package-plugin.mjs yourname.your-plugin
```

Unzip the archive from `.out/`, then in Studio open
**Launcher → Plugins → Install from folder** and select the unzipped folder.
