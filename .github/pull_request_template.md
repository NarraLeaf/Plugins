<!-- Pull requests target `develop`, not `master`. -->

## What does this plugin do?

<!-- One or two sentences. For changes to an existing plugin, describe what changed. -->

## Checklist

- [ ] Directory name matches the `id` in `manifest.json`
- [ ] `manifest.json` and `package.json` declare the same `version`
- [ ] `yarn.lock` is committed
- [ ] `yarn typecheck` and `yarn build` pass in the plugin directory
- [ ] `node scripts/validate.mjs` passes
- [ ] `index.json` regenerated with `node scripts/generate-index.mjs` and committed
- [ ] Every registered blueprint node / widget type is declared in `contributes`
- [ ] Installed and tested the packaged zip in Studio

## Permissions

<!--
List every entry in `permissions` and why it is needed. Write "none" if empty.
Plugins are not sandboxed, so an approved permission is real trust — requests
without a stated reason will be sent back.
-->

none

## Compatibility

<!--
For updates to an existing plugin: does this remove or rename any contributed
type, or remove a pin? Those break saved graphs and require a major version bump.
-->
