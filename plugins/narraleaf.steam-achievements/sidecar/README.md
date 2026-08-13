# nl-steam-bridge

The native half of the Steam Achievements plugin: a small executable the game's
main process spawns and talks to over newline-delimited JSON on stdio.

It exists because Steamworks is a native C API and a plugin's runtime entry runs
in the game's **renderer** process, which cannot load a dynamic library.

## Status

Built and run against a live Steam client on `windows-x64`, with
`steamworks 0.13.1` / `steamworks-sys 0.13.0`. Verified end to end against
Spacewar (App ID 480), Valve's test app:

- `steam.init` publishes the App ID and reports `available: true` with the real
  App ID and game language back.
- An unknown API name is refused by Steam (`SetAchievement(...) failed`) rather
  than silently succeeding — which is how you know the call is reaching Steam
  and not a stub.
- `ACH_WIN_ONE_GAME`, `NumGames`, `IndicateAchievementProgress` and
  `ResetAllStats` all succeed against Spacewar's real schema, and `StoreStats`
  commits them.
- A `req` with no `id` produces no `res` frame, and `bye` exits 0.

macOS and Linux share every line of this source and are wired into the release
workflow, but have not been run against a Steam client. Smoke-test their first
release.

## Building

No Steamworks SDK download, and no Valve partner account. `steamworks-sys`
vendors the SDK under its own `lib/steam/` and its build script falls back to
that copy whenever `STEAM_SDK_LOCATION` is unset — which is also why the crate
builds on docs.rs. Set `STEAM_SDK_LOCATION` only if you deliberately want a
different SDK version.

From the plugin root, for the platform you are on:

```sh
yarn build:sidecar
```

That runs `cargo build --release` for the host target, drops the executable into
`../bin/<platform-arch>/`, and copies the Steam shared library out of cargo's
`OUT_DIR` next to it — the same bytes the executable was linked against, so the
two can never disagree. On macOS it builds both arches and `lipo`s them into one
universal image. Then `yarn build` in the plugin root hashes whatever is in
`bin/` and writes the digests into the shipped manifest.

### The shared library must sit next to the executable

- **Windows** searches the executable's own directory first, so nothing extra is
  needed.
- **Linux and macOS** search an rpath, so `sidecar/build.mjs` passes
  `-Wl,-rpath,$ORIGIN` / `@executable_path`. Without it the binary loads on the
  build machine (where the SDK is on the library path) and fails on every
  player's.

### Cross-building

Do not. A Windows host cannot set the executable bit on a macOS or Linux artifact
(NTFS has none), so the packaged sidecar arrives unrunnable; Studio's preflight
refuses those combinations for exactly this reason. Build each target on its own
platform, or in CI.

## The crate API

Pinned to `steamworks = "=0.13.1"` with `steamworks-sys = "=0.13.0"` (there is no
0.13.1 of the -sys crate). The wrapper's shape has moved across releases, so a
minor bump is a code change rather than a version bump. What this source depends
on:

- `Client::init() -> SIResult<Client>` — one `Client`, which pumps its own
  callbacks. Up to 0.10 this handed back a separate `SingleClient`.
- `UserStats::{set_stat_i32, set_stat_f32, store_stats, reset_all_stats}` and
  `achievement(name).set()`.
- **No `request_current_stats`.** Valve deprecated `RequestCurrentStats` in SDK
  1.59, which fetches the current user's stats during init, and the crate dropped
  the binding. Calling it is not merely unnecessary now — it does not compile.
- `Apps::current_game_language` and `Utils::app_id`.
- `steamworks_sys::SteamAPI_SteamUserStats_v013()` plus
  `SteamAPI_ISteamUserStats_IndicateAchievementProgress`, through raw FFI:
  progress toasts are not on `AchievementHelper` at this version. The `_v013`
  suffix is the interface version and moves with the SDK, so it is the first
  thing to check on a bump. If a later release grows an equivalent on
  `AchievementHelper`, prefer it and delete the `unsafe` block.

## The wire protocol

Reconciled against the host implementation (`src/runtime/main/sidecarHost.ts`).
The host is the authority; this binary is the client.

```text
host -> {"t":"hello","protocol":1,"pluginId":…,"sidecarId":…,"cwd":…,
         "mode":"preview"|"production","game":{"name":…,"version":…}}
us   -> {"t":"ready","protocol":1,"caps":["achievements","stats"]}
host -> {"t":"req","id":7,"method":"…","params":{…}}
us   -> {"t":"res","id":7,"result":{…}}  |  {"t":"res","id":7,"error":{"message":"…","code":…}}
us   -> {"t":"evt","method":"…","params":{…}}
host -> {"t":"bye"}
```

Four rules that are easy to get wrong:

- **There is no `notify` frame type.** A notify is a `req` with no `id`, and it
  gets no reply.
- **Events are `evt`, not `event`.** This binary emits none today, but the host
  forwards them to the plugin's `handle.onEvent`.
- **stdout is the protocol, stderr is the log.** The host classifies each stderr
  line by a leading `error:` / `warn:` and treats everything else as `info` —
  which a **production build discards**. Anything a player's log must show has to
  carry a prefix.
- **Keep lines short.** The host drops any single line over 1 MiB and
  resynchronises on the next newline, so no method may stream a payload.

Correlation ids are the host's and are always numbers; a response echoes the id
it was given. stdin EOF means terminate immediately — it is the only shutdown
signal that survives the game's main process dying uncleanly.

## The App ID

`SteamAPI_Init` resolves the App ID once, during init, from `SteamAppId` in the
environment and then from `steam_appid.txt` in the working directory. **Nobody
has to place that file by hand.** The App ID is already authored in the
achievement catalog, the plugin sends it over in its first call
(`steam.init` with `{"appId":"480"}`), and this process writes it out itself —
`publish_app_id` in `src/steam.rs`, which runs *before* init:

1. If Steam launched the game it already exported `SteamAppId`, and that value
   wins. The catalog is not consulted, and a disagreement is logged as a warning.
2. Otherwise the App ID is written to `steam_appid.txt` in the working directory
   and exported as `SteamAppId`.

This is why `Bridge::init` is not called at startup: it cannot run until the App
ID has arrived. Until then the process idles on a blocking stdin read.

The working directory is a per-sidecar folder the host creates under the
player's `userData` — an author could not find it, and the plugin's runtime API
has no filesystem to write into it. The sidecar is the half of this plugin that
has both.

## Running it by hand

Type the two host frames on stdin; replies come back on stdout. `480` is
Spacewar, Valve's test app — nothing has to be placed in the directory first,
`steam.init` is what publishes the App ID. Copy the shared library in beside the
executable, or init will fail to load it.

```sh
cd /some/writable/dir
./nl-steam-bridge
{"t":"hello","protocol":1,"cwd":".","mode":"preview","game":{"name":"test","version":null}}
{"t":"req","id":1,"method":"steam.init","params":{"appId":"480"}}
{"t":"req","id":2,"method":"achievements.unlock","params":{"id":"ACH_WIN_ONE_GAME"}}
{"t":"req","id":3,"method":"stats.store"}
{"t":"bye"}
```

A `steam_appid.txt` will appear in the directory afterwards; that is the binary
publishing its own App ID, not something you were supposed to provide.
