# Steam Achievements

Unlock Steam achievements and update stats from blueprint graphs.

**Steam is optional.** Every write node updates a local mirror first and only
then echoes to Steam; every read node reads the mirror. So the same script works
on the Steam build, the itch build, the web export, Android, iOS, Dev Mode, and a
dev machine with Steam closed. Degrading is the design, not a fallback.

## What happens where

| Where the game runs | Achievements and stats | Steam |
|---|---|---|
| Desktop build or preview, Steam running | saved on the device | written as they happen; achievements earned earlier with Steam closed are sent when the game starts |
| Desktop build or preview, Steam closed | saved on the device | nothing; sent the next time the game starts with Steam running |
| Dev Mode | saved with the project's Dev Mode data | never connects |
| Web and mobile builds | saved on the device | never connects |

On every row the nodes run and answer the same way. What changes is only whether
Steam hears about it, so a player on the web, on mobile or on itch earns
achievements nobody but your own interface can show them.

`Steam Available` answers `false` on every row but the first. `Owns DLC` answers
`Not Owned` wherever Steam cannot be asked.

## What it adds

**An achievements editor** — a full editor tab (opened from the left rail's
trophy icon). It asks for what the game uses and nothing else: the Steam App ID,
each achievement's API Name, and each stat's API Name, type, default and bounds.
API Names are checked for the shape Steam accepts and for duplicates.

An achievement's name, description, icons and hidden flag are set on the
Steamworks partner site, and Steam draws them from there; they are not asked for
here. A catalog authored with 0.1, which did ask for them, keeps them on disk.

**Eleven blueprint nodes**, all under the `Steam` category:

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
| Owns DLC | — | `BIsDlcInstalled` |
| Reset All Stats | clears the mirror | `ResetAllStats` |

`Open Store Page` leaves by `Failed` with a sentence on `Error` whenever the page
cannot be handed over — no App ID for this build, an App ID that is not a number,
or an environment with nowhere to send the player (the editor, or a Studio older
than the plugin's address permission). It never throws: a store link is not worth
taking a running game down for. Leave its App ID blank for this build's own page,
or fill in a DLC's to send the player there instead.

## Owns DLC is for offering a purchase, never for gating content

`Owns DLC` answers whether this account owns the DLC with that Steam App ID. Use
it to decide whether to draw a purchase button — showing "buy the extra chapter"
to somebody who already bought it is the fault it fixes.

**Do not gate content on it.** Whether the content is *available* is Studio's own
`Is DLC Installed`, which reads the files beside the game. Steam can only be asked
when it is running and reachable, so a graph that gated content on this node would
take an offline player's bought chapter away from them.

That is also why an unreachable Steam answers `Not Owned` rather than failing: the
worst that does is offer a purchase to somebody who already made one, and the store
page they land on says so. The other direction would hide what they paid for.

Every node also takes an optional wired id pin that overrides the inspector's
picker, so a graph can walk a list — an in-game achievement gallery, a debug
"grant everything" menu — instead of being limited to one hand-picked entry.

Stats are `int` or `float`. Steam's third kind, average-rate, is not offered —
see [Known gaps](#known-gaps).

## The Steam App ID

Type it into the achievements tab and you are done. Nothing has to be dropped
into a folder on disk, and there is no second App ID anywhere else.

The field lives in the catalog, the plugin hands it to the native bridge on the
first call of a session, and the bridge publishes it to `SteamAPI_Init` itself —
writing `steam_appid.txt` into its own working directory and exporting
`SteamAppId` — because that directory sits under the player's `userData` where no
author would find it, and the plugin's runtime API has no filesystem anyway.

When Steam launched the game it has already set `SteamAppId`, and *that* wins:
it describes the app actually running. A disagreement with the catalog is logged
rather than acted on.

`Open Store Page` with its App ID left blank opens the running game's own page:
the App ID Steam reports when it is running, else the tab's. A demo is a separate
Steam app that Steam starts under the demo's App ID, so its blank node opens the
demo's page; a "buy the full game" button in the demo names the full game's App
ID on the node, the same way a DLC button names the DLC's.

## Which platforms reach Steam

The bridge is a native executable, so it exists only where one was built. A
package carries a sidecar for a platform if, and only if, that binary was present
when `yarn build` ran — see [Building the sidecar](#building-the-sidecar).

**A package with no bridge at all is not a broken package.** It is the
mirror-only build: every node still runs, every read still answers, nothing is
echoed to Steam. That is already what happens on the web export and on mobile,
which can never host a native child process, and on a desktop player who has
Steam closed. There is one behaviour to reason about, and it is the mirror.

Dev Mode never starts the bridge either; preview does, so preview is where a
connection to Steam is first tried from Studio.

**Achievements are replayed, stats are not.** Every time the bridge connects,
it sends Steam each achievement the mirror holds, and the game starts the bridge
as soon as it runs if the mirror holds any. Unlocking is idempotent on Steam's
side, so this costs a few calls and settles every unlock earned while Steam was
closed. A stat is an absolute value, and replaying this device's copy would
overwrite a higher one Steam holds from another machine; a stat reaches Steam on
its next write.

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

- **Reads are this device's answer, not Steam's.** `Is Achievement Unlocked` and
  `Get Stat` read the mirror, so a player who unlocked something on another
  machine reads `false` here until it is unlocked again on this one. Nothing reads
  Steam's state back into the mirror.
- **The editor speaks English and Chinese.** Japanese editors see English.
- **No `avgrate` stats.** Steam writes average-rate stats with
  `UpdateAvgRateStat(name, countThisSession, sessionLength)`, and no node here
  has a session length to give — so an `avgrate` stat could only ever reach the
  local mirror and would never once appear on Steam. Offering a type that
  silently never syncs is worse than not offering it, so the type is gone: pick
  `int` or `float`. (A catalog authored while it existed keeps its values; those
  stats load as `float`.) Restoring it means first deciding what a session is in
  a visual novel, and giving the nodes a way to say so.
- **No in-game achievement list.** The game knows which API Names are unlocked
  and their progress, but not their names, descriptions or icons, which live in
  Steamworks. An in-game list draws those from your own widgets.
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
