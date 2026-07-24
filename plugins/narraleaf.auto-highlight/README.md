# Auto-Highlight

Lights whoever is speaking and dims everyone else — automatically, at compile time.

When a character speaks, they are restored to full brightness and everyone else on stage is
darkened. When they finish speaking (the end of a run of their lines, not each individual line),
everyone is darkened. It never inspects the stage at runtime and never touches your document:
the darkens are generated while the story compiles and vanish the moment the plugin is disabled.

## Story actions

| Action | What it does |
| --- | --- |
| **Enable Auto-Highlight** | From here on, each line lights its speaker and dims the rest. |
| **Disable Auto-Highlight** | Stop auto-highlighting and restore everyone. |
| **Highlight Characters** | Light the chosen characters, dim the rest (a one-off override). |
| **Highlight All** | Restore everyone to full brightness. |
| **Darken All** | Dim everyone. |

Enable/Disable are stateful and scene-scoped: the flag resets on scene entry, so a scene must
Enable it explicitly (a `jump` into the middle of a scene leaves auto-highlighting off). The
three manual actions are immediate one-off overrides; while auto-highlighting is on, the next
line re-computes from its speaker and supersedes them.

The plugin owns the `darkness` channel while enabled — don't also drive character darken by
hand in a project that uses it.

## Configuration

Project-level, stored in the `config` runtime-data namespace and baked into the packed game:

| Key | Default | Notes |
| --- | --- | --- |
| `amount` | `0.5` | Darken strength for non-speakers, 0..1. |
| `durationMs` | `300` | Darken/restore transition length. |
| `easing` | `"easeOut"` | Never empty — an empty easing makes older engines jump instead of animate. |
| `narrationBreaksRun` | `true` | Whether a narration line ends a speaker's run. |
| `exclude` | `[]` | Characters that are never darkened. |

## Layout

- `planner.ts` — the pure core: scene units → per-unit darken plan (run detection, speaker
  sets, Enable/Disable state model, overrides, exclude). No Studio or engine dependency; fully
  unit-tested (`planner.test.ts`).
- `adapter.ts` — maps the compile context onto planner units and renders the plan back into
  engine actions (`adapter.test.ts`).
- `config.ts` — the config shape, defaults, and `normalizeConfig` (graceful degradation).
- `runtime.ts` / `main.ts` — the thin entries: register the compile pass and the story actions.
- `contract.ts` / `studio-contract.ts` — the Studio APIs this plugin is written against.

## Status

⚠️ **This plugin depends on a Studio extension point that is not yet shipped.** The
compile-time darken injection needs `app.game.story.registerCompilePass` (runtime) and the
declarative story-action registration (studio). Both are specified as types in `contract.ts`
and `studio-contract.ts` (plan `2026-07-15-003`, §3.10 / §4.2). The core planner and adapter are
implemented and tested; the entries are written against those contracts and become live once
Studio ships them.

## Develop

```bash
corepack enable
yarn install
yarn test        # planner + adapter + config
yarn typecheck
yarn build       # bundles dist/main.js, dist/runtime.js, dist/manifest.json
```
