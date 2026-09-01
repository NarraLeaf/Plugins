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
| **Highlight Characters** | Light the characters you name, dim the rest (a one-off override). |
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
- `contract.ts` — the Studio types the published package does not carry yet (see above).

Name the cast on the same line you insert the action: `Highlight Characters Alice Bob`. Names are
split on spaces and on commas (`,` `，` `、`), stored as typed, and matched against the scene's cast
when the story compiles - a name that matches nobody is simply not lit. There is no picker for it,
because a plugin row has no inspector to draw one in.

## Requires

**NarraLeaf Studio 0.6.0 or newer**, and the plugin asks for one capability at install: *take part
in compiling your stories*. That is `story.compile`, which is what lets the pass put darkens around
lines the plugin did not write.

`contract.ts` mirrors the handful of Studio types that the published `narraleaf-studio` package
(0.5.0) does not carry yet. It goes away, along with two casts, the moment 0.6.0 is published.

## Develop

```bash
corepack enable
yarn install
yarn test        # planner + adapter + config
yarn typecheck
yarn build       # bundles dist/main.js, dist/runtime.js, dist/manifest.json
```
