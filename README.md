# NarraLeaf Plugins

The official plugin registry for [NarraLeaf Studio](https://github.com/NarraLeaf/NarraLeaf-Studio).

Every plugin listed here is reviewed and published by the NarraLeaf team. Each one lives in its own directory under [`plugins/`](plugins/), resolves its own dependencies, and is released independently by pushing a git tag. [`index.json`](index.json) is the generated, machine-readable index a future in-Studio browser will fetch.

[简体中文](README.zh-CN.md)

## Install a plugin

1. Download the plugin's `.zip` from its [release](https://github.com/NarraLeaf/Plugins/releases) and unzip it — you get one folder containing `manifest.json`.
2. In Studio: **Launcher → Plugins → Install from folder**, and select that folder.

Full walkthrough: **[Install a plugin](https://narraleaf.com/docs/studio/plugin/install-plugin)**.

> **Plugins are not sandboxed.** A plugin runs with the privileges its manifest declares, and Studio prompts you for them at install time. Read the `permissions` field before installing anything — including from here.

## Write a plugin

Copy the [`template/`](template/) directory to start, then follow the guides on the documentation site:

- **[Make a plugin](https://narraleaf.com/docs/studio/plugin/create-first-plugin)** — from an empty folder to an installed plugin.
- **[API reference](https://narraleaf.com/docs/studio/plugin/api-reference)** — the studio and runtime surfaces, method by method.
- **[Plugin overview](https://narraleaf.com/docs/studio/plugin)** — the two entry targets and how the pieces fit.

```bash
cp -r template plugins/yourname.your-plugin
cd plugins/yourname.your-plugin
corepack enable
yarn install
yarn build
```

Validate and package locally before opening a pull request:

```bash
node scripts/validate.mjs yourname.your-plugin       # port of Studio's manifest validator
node scripts/generate-index.mjs                      # regenerate index.json
node scripts/package-plugin.mjs yourname.your-plugin # build + zip to .out/
```

## Contributing

Full details in [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

1. Branch from `develop`.
2. Add or change a plugin under `plugins/`.
3. Run `node scripts/generate-index.mjs` and commit the result.
4. Open a pull request against `develop`.

| Branch    | Purpose                                             |
| --------- | --------------------------------------------------- |
| `master`  | Released state. Every release tag is cut from here. |
| `develop` | Integration branch. All pull requests target this.  |

Releases are per-plugin: bump `version` in `manifest.json` and `package.json`, regenerate `index.json`, merge to `master`, and push the tag (`git tag narraleaf.example@1.0.0`). The release workflow refuses to publish if the tag, manifest, and index disagree.

## License

The registry tooling is [MPL-2.0](LICENSE), matching NarraLeaf Studio. **Each plugin declares its own license** in its `package.json`; check the plugin before you depend on it.
