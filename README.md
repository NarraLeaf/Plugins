# NarraLeaf Plugins

The official plugin registry for [NarraLeaf Studio](https://github.com/NarraLeaf/NarraLeaf-Studio).

Every plugin listed here is reviewed and published by the NarraLeaf team. Each
one lives in its own directory under [`plugins/`](plugins/), resolves its own
dependencies, and is released independently by pushing a git tag.

[简体中文](README.zh-CN.md)

---

## For users

### Installing a plugin

1. Find the plugin in [`index.json`](index.json) or under [`plugins/`](plugins/).
2. Download the `.zip` from its release — the URL is in the plugin's
   `release.download` field, or browse [Releases](https://github.com/NarraLeaf/Plugins/releases).
3. Unzip it. You get one folder named after the plugin id, e.g. `narraleaf.example/`.
4. In Studio: **Launcher → Plugins → Install from folder**, and select that folder.

Studio installs plugins from a local directory. There is no in-app store yet, so
this repository is the distribution channel until one exists.

> **Plugins are not sandboxed.** A plugin runs with the privileges its manifest
> declares, and Studio prompts you for them at install time. Read the
> `permissions` field before installing anything — including from here.

### `index.json`

A machine-readable list of every published plugin, generated from the manifests
in this repository. It is the file a future in-Studio plugin browser will fetch.

```jsonc
{
  "formatVersion": 1,
  "repository": "https://github.com/NarraLeaf/Plugins",
  "plugins": [
    {
      "id": "narraleaf.example",           // namespaced plugin id
      "name": "Example",
      "version": "1.0.0",
      "description": "…",
      "publisher": "NarraLeaf",
      "path": "plugins/narraleaf.example", // source directory in this repo
      "targets": ["studio", "runtime"],    // which entries the plugin declares
      "categories": ["blueprint"],
      "keywords": ["…"],
      "license": "MPL-2.0",
      "studioVersion": ">=0.0.1",          // optional, advisory
      "contributes": {
        "blueprintNodes": ["narraleaf.example.node"],
        "widgets": []
      },
      "permissions": [],                   // what the plugin asks for at install
      "release": {
        "tag": "narraleaf.example@1.0.0",
        "page": "https://github.com/…/releases/tag/…",
        "download": "https://github.com/…/releases/download/…/narraleaf.example-1.0.0.zip"
      }
    }
  ]
}
```

`index.json` is **generated, never hand-edited**. Release URLs are derived from
`(id, version)` rather than read from the GitHub API, which is what lets a
version bump and its index entry land in the same reviewable pull request —
before the tag is pushed and the release exists.

---

## For plugin authors

### Repository layout

```
plugins/<plugin-id>/     one directory per plugin, named exactly after its id
  manifest.json          Studio's contract — what Studio reads at install
  package.json           npm metadata + registry metadata under "narraleaf"
  yarn.lock              committed; each plugin resolves independently
  build.mjs              bundles each declared entry into dist/
  src/                   plugin source
  types/                 ambient declarations for the host modules

template/                starter plugin — copy this to begin
scripts/                 registry tooling (dependency-free Node ESM)
schema/                  JSON Schemas for manifest.json and index.json
index.json               generated registry index
```

**No workspaces, no hoisting.** Each plugin directory is a standalone package
with its own `node_modules`, its own lockfile, and its own pinned toolchain.
Two contributors working on two plugins never touch the same dependency tree,
and a broken dependency in one plugin cannot break another's build.

### Getting started

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin

corepack enable          # each plugin pins its own Yarn via "packageManager"
yarn install
yarn build               # -> dist/
```

Then edit `manifest.json`:

| Field            | Rule                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| `manifestVersion`| Must be exactly `2`. Studio hard-rejects v1.                                |
| `id`             | `publisher.plugin-name`, lowercase. **The directory must be named after it.** |
| `version`        | Semver. Must match `package.json` `version`.                                |
| `entries`        | At least one of `studio` / `runtime`, each a prebundled ESM file in `dist/`. |
| `contributes`    | Every blueprint node and widget type you register, prefixed with your id.   |
| `permissions`    | Only what you actually need — users see this at install.                    |

Anything you register at runtime **must** be declared in `contributes`, or
Studio throws at load. This exists so Studio can validate a project statically
without executing plugin code.

Also set `narraleaf.categories` in `package.json` (one or more of `blueprint`,
`ui`, `assets`, `story`, `workflow`, `integration`, `theme`, `other`).

### The two entries

A plugin can target the editor, the game, or both.

| Entry     | Runs in                                        | Gets                                                            |
| --------- | ---------------------------------------------- | --------------------------------------------------------------- |
| `studio`  | The editor                                     | `app.services` (curated whitelist) + `app.privileged` (audited)  |
| `runtime` | The game — Dev Mode, Preview, Production builds | `app.game` only: blueprint nodes, widgets, `log()`               |

The two are physically isolated: importing `narraleaf-studio/plugin` from a
runtime entry throws. If a blueprint node should both appear in the editor
palette *and* execute in a shipped build, put the definition in a shared module
and register it from both entries — that is what `template/src/nodes.ts` does.

The `studio` entry has an unload lifecycle; the `runtime` entry does not (game
environments load once per process).

### Types

Studio does not yet publish a types package for `narraleaf-studio/plugin` and
`narraleaf-studio/runtime` — these specifiers resolve only at runtime, via an
import map the host installs. Until it does, each plugin carries a copy of
[`types/narraleaf-studio.d.ts`](template/types/narraleaf-studio.d.ts). The
plugin-facing surface in it is accurate; deep editor structures are typed
permissively on purpose. Prefer a runtime check over trusting a loose type there.

### Local testing

```bash
node scripts/validate.mjs                            # validate every plugin
node scripts/validate.mjs yourname.your-plugin       # validate just yours
node scripts/generate-index.mjs                      # regenerate index.json
node scripts/package-plugin.mjs yourname.your-plugin # build + zip to .out/
```

`validate.mjs` runs a port of Studio's own manifest validator, so a plugin that
passes here is one Studio will accept at install time. Unzip the `.out/` archive
and install it through Studio to test for real.

---

## Contributing

Full details in [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

1. Branch from `develop`.
2. Add or change a plugin under `plugins/`.
3. Run `node scripts/generate-index.mjs` and commit the result.
4. Open a pull request against `develop`.

### Branches

| Branch    | Purpose                                                              |
| --------- | -------------------------------------------------------------------- |
| `master`  | Released state. Every release tag is cut from here.                  |
| `develop` | Integration branch. All pull requests target this.                   |

### Releasing (maintainers)

Releases are per-plugin, not per-repository:

1. Bump `version` in both `manifest.json` and `package.json`.
2. Regenerate `index.json` and merge the change to `develop`, then to `master`.
3. Push the tag from `master`:

   ```bash
   git tag narraleaf.example@1.0.0
   git push origin narraleaf.example@1.0.0
   ```

The release workflow verifies the tag agrees with both `manifest.json` and
`index.json`, refuses to publish if they disagree, then builds, packages and
attaches the zip to a GitHub Release. Tagging is the only way to publish — and
because tags carry the plugin id, each plugin versions independently.

---

## License

The registry tooling in this repository is [MPL-2.0](LICENSE), matching
NarraLeaf Studio. **Each plugin declares its own license** in its
`package.json`; check the plugin before you depend on it.
