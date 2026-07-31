# Contributing

This repository holds **officially licensed** NarraLeaf Studio plugins. Anything
merged here is distributed under the NarraLeaf name, so submissions are reviewed
for behaviour and permissions, not just for whether they build.

See the [plugin authoring guide](docs/authoring.md) for how to build a plugin.
This document covers the process for getting one merged.

## Before you start

If you are proposing a **new** plugin, open an issue first describing what it
does and which permissions it needs. It is better to hear "this belongs in your
own repository" before you write it than after.

You do not need to publish here to write a Studio plugin. Studio installs from
any local folder — this repository is for plugins the NarraLeaf team maintains
and vouches for.

## Workflow

1. Fork, then branch from `develop`. All pull requests target `develop`;
   `master` only moves through release merges.
2. Copy `template/` to `plugins/<your-plugin-id>/`. The directory name must
   equal the `id` in `manifest.json` — CI enforces this.
3. Build and validate locally:

   ```bash
   cd plugins/<your-plugin-id>
   corepack enable && yarn install && yarn typecheck && yarn build
   cd ../..
   node scripts/validate.mjs <your-plugin-id>
   node scripts/generate-index.mjs
   ```

4. Commit `yarn.lock` and the regenerated `index.json`.
5. Open the pull request.

## Requirements

A pull request is mergeable when:

- **The directory is self-contained.** Its own `package.json`, `yarn.lock`, and
  `node_modules`. No workspace membership, no reaching into another plugin's
  files, no shared root dependencies.
- **`yarn.lock` is committed.** Without it neither reviewers nor the release
  runner build what you built.
- **Versions agree.** `manifest.json` `version` == `package.json` `version`.
- **`index.json` is regenerated.** CI fails on drift. Never hand-edit it.
- **Everything registered is declared.** Every blueprint node and widget type
  passed to a `register*` call must appear in `contributes` and be prefixed with
  your plugin id, or Studio throws at load.
- **Permissions are minimal.** Every entry in `permissions` needs a reason in
  the pull request description. Filesystem and API permissions get the most
  scrutiny — plugins are not sandboxed, so an approved permission is real trust.
- **An icon, if you ship one, is square.** `manifest.json` may declare
  `"icon": "icon.png"` — a package-relative path to the thumbnail Studio shows
  beside your plugin in the Launcher list, installed and store alike. It must be
  `.png`, `.webp`, `.jpg` or `.jpeg` (no SVG — it is a document that can carry
  script; no GIF — an animating row is not yours to impose), square, between
  64x64 and 512x512, and at most 512 KB. Your build script has to copy it into
  `dist/` the way it copies `manifest.json`; the template's already does.
  `scripts/validate.mjs` checks every rule, and Studio refuses to install a
  package whose icon is missing or out of bounds. Plugins without one keep the
  monogram tile Studio draws from the name — that is a fine place to stay, but
  do replace the template's placeholder piece before publishing.
- **Host modules stay external.** Never bundle `react`, `react-dom`, or
  `narraleaf-studio/*`. The host supplies them through an import map; bundling
  React produces a second, broken instance. The template's `build.mjs` already
  handles this.
- **`yarn typecheck` passes.**

## Versioning

Semver, per plugin:

- **patch** — fixes with no change to node types, pins, or params.
- **minor** — new nodes, widgets, or optional pins.
- **major** — removing or renaming a contributed type, removing a pin, or
  changing what an existing node does to an existing graph.

Renaming or removing a contributed type breaks every saved graph that uses it.
Studio marks such nodes as missing rather than silently dropping them, but the
project still needs manual repair — treat it as a major change and say so in the
pull request.

## Review and release

Maintainers merge to `develop`, then to `master`. Releases are cut from `master`
by pushing a `<plugin-id>@<version>` tag; the release workflow refuses to publish
if the tag, `manifest.json`, and `index.json` disagree. See
[README.md](README.md#releasing-maintainers).

## Keeping the validator honest

`scripts/lib/plugins.mjs` contains a port of Studio's manifest validator
(`src/shared/utils/pluginManifest.ts`). If Studio's validation rules change,
update the port in the same change — otherwise CI accepts manifests that Studio
rejects at install, which is the worst possible failure mode for a registry.
