# Steam Achievements

Author Steam achievements and stats in Studio, and unlock them from blueprint
graphs.

**Steam is optional.** Every write node updates a local mirror first and only
then echoes to Steam; every read node reads the mirror. So the same script works
on the Steam build, the itch build, the web export, Android, iOS, Dev Mode, and a
dev machine with Steam closed. Degrading is the design, not a fallback.

> **Status: not shippable yet.** The native bridge has never been compiled and
> the sha256 digests in `manifest.json` are placeholders, so this package will
> fail to install as-is. See [Building the sidecar](#building-the-sidecar).

## What it adds

**An achievements editor** — a full editor tab (opened from the left rail's
trophy icon), because the achievement table needs width the side panel does not
have. Inline editing, icons picked from the asset library, one language at a time
via the language switcher, and inline validation: API-name shape and uniqueness,
progress achievements pointing at a stat that exists, and missing text in any
language you have declared.

**Nine blueprint nodes**, all under the `Steam` category:

| Node | Local mirror | Steam |
|---|---|---|
| Unlock Achievement | adds to the unlocked set | `SetAchievement` |
| Is Achievement Unlocked | **reads the mirror** | — |
| Indicate Achievement Progress | records current/max | `IndicateAchievementProgress` toast |
| Set Stat / Add Stat | writes the value (clamped by the catalog's min/max/incrementOnly) | `SetStat` |
| Get Stat | **reads the mirror** | — |
| Steam Available | — | `SteamAPI_Init` succeeded |
| Steam Language | — | `GetCurrentGameLanguage` |
| Reset All Stats | clears the mirror | `ResetAllStats` |

Every node also takes an optional wired id pin that overrides the inspector's
picker, so a graph can walk a list — an in-game achievement gallery, a debug
"grant everything" menu — instead of being limited to one hand-picked entry.

Stats are `int` or `float`. Steam's third kind, average-rate, is not offered —
see [Known gaps](#known-gaps).

## The Steam App ID

Type it into the achievements tab and you are done. Nothing has to be dropped
into a folder on disk.

The field lives in the catalog, the plugin hands it to the native bridge on the
first call of a session, and the bridge publishes it to `SteamAPI_Init` itself —
writing `steam_appid.txt` into its own working directory and exporting
`SteamAppId` — because that directory sits under the player's `userData` where no
author would find it, and the plugin's runtime API has no filesystem anyway.

When Steam launched the game it has already set `SteamAppId`, and *that* wins:
it describes the app actually running. A disagreement with the catalog is logged
rather than acted on.

## Capabilities it asks for

`contributes.runtimeCapabilities: ["store"]`, and nothing else.

`store` is the local mirror: `src/bridge.ts` reads and writes three keys
(`…unlocked`, `…stats`, `…progress`) through `app.game.store`. It is the only
gated domain the plugin touches — no `state`, no `saves`, no `events`, no
`locale`, no `assets` in the game.

`app.game.sidecar` has no capability of its own: declaring
`contributes.sidecars` *is* the request, and the install prompt names the
binaries and platforms.

The Steamworks redistributable is declared as
`contributes.buildDependencies`, so Studio fetches and verifies it at project
build time; it is not vendored here.

## Building the sidecar

`sidecar/` holds the Rust source for `nl-steam-bridge`, the native child process
that actually talks to Steamworks. **It has never been compiled** — see
[sidecar/README.md](sidecar/README.md) for the build steps, the crate calls that
need checking, and why cross-building is refused.

Before this plugin can be released:

1. Build the binary on each of Windows x64, macOS (universal), Linux x64.
2. Put them under `bin/<platform-arch>/` and replace every placeholder digest in
   `manifest.json` (they are currently 64 zeros) with the real sha256 — Studio
   verifies each one at install.
3. Fill in the Steamworks SDK zip digest in `contributes.buildDependencies`.

`yarn build` checks each digest and copies the payload into `dist/`. A *missing*
binary is only a warning so the JS half stays buildable without a Rust
toolchain; a *mismatched* one is fatal.

## Known gaps

- **`yarn typecheck` fails against the published types.** The plugin is written
  against the unreleased plugin API (the narrowed node context, `app.game.store`,
  `app.game.sidecar`), which `narraleaf-studio@0.2.0` predates. Bump the
  devDependency to `^0.3.0` once it is published; until then only `yarn build`
  (esbuild, which strips types without checking them) is meaningful.
- **Release languages are authored here, not read from the project.** The studio
  plugin surface exposes no project settings, so the catalog carries its own
  `locales` list and validation checks against that.
- **No `avgrate` stats.** Steam writes average-rate stats with
  `UpdateAvgRateStat(name, countThisSession, sessionLength)`, and no node here
  has a session length to give — so an `avgrate` stat could only ever reach the
  local mirror and would never once appear on Steam. Offering a type that
  silently never syncs is worse than not offering it, so the type is gone: pick
  `int` or `float`. (A catalog authored while it existed keeps its values; those
  stats load as `float`.) Restoring it means first deciding what a session is in
  a visual novel, and giving the nodes a way to say so.
- **No Steamworks backend export yet.** Achievement schemas are entered on the
  partner site; the export (VDF + 64x64 icons) needs a spike against the current
  partner documentation and is deliberately not guessed at here. The 64x64 PNG
  requirement is therefore not validated either.
- **Icons never reach the game.** They exist for the backend export. In-game
  achievement art should come from the gallery plugin or your own widgets.

## Development

```sh
yarn install
yarn build          # or: yarn dev, for unminified output with sourcemaps
```

To typecheck against an unreleased Studio API, stage its generated
`packages/plugin-types/dist` somewhere and point a throwaway tsconfig's `paths`
at it — keep the staged copy under `node_modules/` so React's types still
resolve from this package.
