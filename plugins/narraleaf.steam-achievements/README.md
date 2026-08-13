# Steam Achievements

Author Steam achievements and stats in Studio, and unlock them from blueprint
graphs.

**Steam is optional.** Every write node updates a local mirror first and only
then echoes to Steam; every read node reads the mirror. So the same script works
on the Steam build, the itch build, the web export, Android, iOS, Dev Mode, and a
dev machine with Steam closed. Degrading is the design, not a fallback.

## What it adds

**An achievements editor** — a full editor tab (opened from the left rail's
trophy icon), because the achievement table needs width the side panel does not
have. Inline editing, icons picked from the asset library, one language at a time
via the language switcher, and inline validation: API-name shape and uniqueness,
progress achievements pointing at a stat that exists, and missing text in any
language you have declared.

**Ten blueprint nodes**, all under the `Steam` category:

| Node | Local mirror | Steam |
|---|---|---|
| Unlock Achievement | adds to the unlocked set | `SetAchievement` |
| Is Achievement Unlocked | **reads the mirror** | — |
| Indicate Achievement Progress | records current/max | `IndicateAchievementProgress` toast |
| Set Stat / Add Stat | writes the value (clamped by the catalog's min/max/incrementOnly) | `SetStat` |
| Get Stat | **reads the mirror** | — |
| Steam Available | — | `SteamAPI_Init` succeeded |
| Steam Language | — | `GetCurrentGameLanguage` |
| Open Store Page | — | store page in the client, else in the browser |
| Reset All Stats | clears the mirror | `ResetAllStats` |

`Open Store Page` leaves by `Failed` with a sentence on `Error` whenever the page
cannot be handed over — no App ID for this build, an App ID that is not a number,
or an environment with nowhere to send the player (the editor, or a Studio older
than the plugin's address permission). It never throws: a store link is not worth
taking a running game down for.

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

**The store link uses a second App ID, stated per build variant.** A demo is a
separate Steam app from the game it demos, and the catalog holds one App ID for
the whole project — so `contributes.buildConfig` declares an `appId` field with
`scope: "variant"`, filled in on the build dialog's Plugins page. `Open Store
Page` prefers it and reads the catalog's only when the variant states nothing;
that fallback names the same app the Steam connection is opened with, and it is
the only App ID that exists in Dev Mode, where builds have not happened yet.

The Steam connection itself still uses the catalog's App ID. Pointing it at the
variant's would change which Steam app a demo's achievements land in, which is a
decision to make deliberately rather than inherit from a store link.

## Which platforms reach Steam

The bridge is a native executable, so it exists only where one was built. A
package carries a sidecar for a platform if, and only if, that binary was present
when `yarn build` ran — see [Building the sidecar](#building-the-sidecar).

**A package with no bridge at all is not a broken package.** It is the
mirror-only build: every node still runs, every read still answers, nothing is
echoed to Steam. That is already what happens on the web export and on mobile,
which can never host a native child process, and on a desktop player who has
Steam closed. There is one behaviour to reason about, and it is the mirror.

## Capabilities it asks for

`contributes.runtimeCapabilities: ["store"]`, and nothing else.

`store` is the local mirror: `src/bridge.ts` reads and writes three keys
(`…unlocked`, `…stats`, `…progress`) through `app.game.store`. It is the only
gated domain the plugin touches — no `state`, no `saves`, no `events`, no
`locale`, no `assets` in the game.

`app.game.sidecar` has no capability of its own: declaring
`contributes.sidecars` *is* the request, and the install prompt names the
binaries and platforms.

`app.game.navigation` works the same way: declaring `contributes.externalLinks`
is the request, and the prompt lists the two patterns by name —
`https://store.steampowered.com/app/*` and `steam://store/*`. The second is not
`steam://*` on purpose. That would also cover `steam://run/<id>`,
`steam://install/<id>` and `steam://uninstall/<id>`, and no prompt could honestly
describe "launch, install and uninstall arbitrary Steam apps" as opening a store
page. Whichever address is asked for, Studio decides it against these patterns in
the process that performs the act — declaring is not deciding.

The Steam shared library (`steam_api64.dll` and its POSIX equivalents) ships
inside the package, beside the executable that links against it. It is not
fetched at build time and needs no Valve account: `steamworks-sys` vendors the
SDK, and `sidecar/build.mjs` copies the very library the binary was linked
against out of cargo's own output — so the two can never drift apart.

## Building the sidecar

`sidecar/` holds the Rust source for `nl-steam-bridge`, the native child process
that talks to Steamworks. Building it needs a Rust toolchain and nothing else —
**no SDK download and no Valve partner account** — because `steamworks-sys`
vendors the Steamworks SDK under its own `lib/steam/` and falls back to that copy
whenever `STEAM_SDK_LOCATION` is unset.

```sh
yarn build:sidecar   # cargo build for THIS platform -> bin/<platform-arch>/
yarn build           # copies bin/ into dist/ and writes the digests
```

Host platform only, deliberately: a Windows host cannot set the executable bit on
a macOS or Linux artifact, so the packaged sidecar would arrive unrunnable — and
Studio's build preflight refuses those combinations for exactly that reason. Each
platform is built on its own runner; see `.github/workflows/release.yml` in the
repository root, which does all three and packages the result.

### Digests are computed, never authored

There is no sha256 to fill in by hand, and no `contributes.sidecars` block in
`manifest.json`. A sidecar target is a claim about bytes — *this package carries
this executable, and its hash is this* — and that claim is only true of a package
that actually has the binary. This repository has none; they are build output.

So `sidecar/contribution.json` holds everything about the sidecar that is *not* a
property of a compiled artifact, and `build.mjs` supplies the rest: it includes
each platform whose files are present, hashes them, and writes the block into
`dist/manifest.json`. Platforms with no binary are dropped with a line saying so.

Studio verifies those digests when it compiles a game — a preview or a build —
not at install. A package whose bytes changed after installation fails there,
with the file and both hashes named.

## Known gaps

- **Release languages are authored here, not read from the project.** The studio
  plugin surface exposes no project settings, so the catalog carries its own
  `locales` list and validation checks against that.
- **The editor tab is English only.** It ships no `contributes.locales` pack, so
  its headers and buttons stay English whatever Studio is set to. The authored
  achievement *text* is fully multilingual; only the chrome is not.
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
- **Only `windows-x64` has been run against a real Steam client.** The macOS and
  Linux builds are wired up in CI and share every line of source, but their first
  release should be smoke-tested on those platforms before it is trusted.

## Development

```sh
yarn install
yarn build          # or: yarn dev, for unminified output with sourcemaps
yarn test           # the catalog's pure half
yarn typecheck
yarn icon           # regenerate icon.png
```
