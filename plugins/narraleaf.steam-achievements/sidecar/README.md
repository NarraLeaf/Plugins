# nl-steam-bridge

The native half of the Steam Achievements plugin: a small executable the game's
main process spawns and talks to over newline-delimited JSON on stdio.

It exists because Steamworks is a native C API and a plugin's runtime entry runs
in the game's **renderer** process, which cannot load a dynamic library.

## Verification status

**This code has never been compiled and has never been run.**

It was written on a machine with no Rust toolchain and no Steamworks SDK (the SDK
requires a Valve partner account to download), so nothing here has been checked by
a compiler, let alone against a running Steam client. Treat it as a specification
in Rust syntax, not as a working binary.

One thing still needs verifying before any of this ships. The wire protocol was
the other, and is now settled — it has been reconciled frame by frame against the
host, see [The wire protocol](#the-wire-protocol).

**The crate API (`src/steam.rs`).** Pinned to `steamworks = "=0.11.0"`. These
calls are the ones most likely to be wrong, in rough order of risk:

- `SteamAPI_SteamUserStats_v013()` and
  `SteamAPI_ISteamUserStats_IndicateAchievementProgress` from `steamworks-sys` —
  the interface accessor carries a version suffix that changes with the SDK. If
  the safe wrapper gained an equivalent on `AchievementHelper`, use that instead
  and delete the `unsafe` block.
- `UserStats::set_stat_i32` / `set_stat_f32` — spelling has moved between
  releases (a `stat_i32(name).set(value)` helper style also exists in some).
- `Client::init()` returning a single `Client` — true from 0.11; 0.10 and earlier
  returned `(Client, SingleClient)` and pumped callbacks on the latter.
- `UserStats::request_current_stats` / `store_stats` / `reset_all_stats`
  return types (`()` vs `Result<_, _>`).
- `Apps::current_game_language` and `Utils::app_id`.

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
  gets no reply. (An earlier draft of this file proposed `t:"notify"`; the host
  never sends it.)
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

## Building

Per platform-arch, on that platform (see "Cross-building" below):

```sh
# Windows x64
cargo build --release --target x86_64-pc-windows-msvc
# -> target/x86_64-pc-windows-msvc/release/nl-steam-bridge.exe
#    into ../bin/windows-x64/

# Linux x64
cargo build --release --target x86_64-unknown-linux-gnu
# -> ../bin/linux-x64/nl-steam-bridge

# macOS universal — build both arches and lipo them together
cargo build --release --target aarch64-apple-darwin
cargo build --release --target x86_64-apple-darwin
lipo -create -output ../bin/macos-universal/nl-steam-bridge \
  target/aarch64-apple-darwin/release/nl-steam-bridge \
  target/x86_64-apple-darwin/release/nl-steam-bridge
```

The `steamworks-sys` build script needs the Steamworks SDK. Download it from the
partner site (a Valve account with a signed agreement is required — it is not
publicly fetchable) and point `STEAM_SDK_LOCATION` at the unpacked `sdk`
directory:

```sh
export STEAM_SDK_LOCATION=/path/to/steamworks_sdk_162/sdk
```

### The shared library must sit next to the executable

`steam_api64.dll` / `libsteam_api.dylib` / `libsteam_api.so` are **not** vendored
here — the plugin manifest declares them as a build dependency so Studio fetches
them at project build time and lands them in the same directory as the binary.

- **Windows** searches the executable's own directory first, so nothing extra is
  needed.
- **Linux and macOS** search an rpath. Link with `$ORIGIN` / `@executable_path`:

  ```sh
  # linux
  RUSTFLAGS="-C link-arg=-Wl,-rpath,\$ORIGIN" cargo build --release --target x86_64-unknown-linux-gnu
  # macos
  RUSTFLAGS="-C link-arg=-Wl,-rpath,@executable_path" cargo build --release --target aarch64-apple-darwin
  ```

  Without this the binary loads on the build machine (where the SDK is on the
  library path) and fails on every player's.

### After building

1. Copy the binaries to `../bin/<platform-arch>/`.
2. Recompute digests and paste them into `../manifest.json` — every
   `contributes.sidecars[].targets[].sha256` currently holds a **placeholder of
   64 zeros**, and Studio rejects the package at install until they are real:

   ```sh
   shasum -a 256 ../bin/windows-x64/nl-steam-bridge.exe
   ```

3. Do the same for the SDK zip's digest in `contributes.buildDependencies`.
4. `yarn build` in the plugin root verifies every digest and copies the payload
   into `dist/`.

### Cross-building

Do not. A Windows host cannot set the executable bit on a macOS or Linux artifact
(NTFS has none), so the packaged sidecar arrives unrunnable; Studio's preflight
refuses those combinations for exactly this reason. Build each target on its own
platform, or in CI.

## Running it by hand

Type the two host frames on stdin; replies come back on stdout. `480` is
Spacewar, Valve's test app — nothing has to be placed in the directory first,
`steam.init` is what publishes the App ID.

```sh
cd /some/writable/dir
./nl-steam-bridge
{"t":"hello","protocol":1,"cwd":".","mode":"preview","game":{"name":"test","version":null}}
{"t":"req","id":1,"method":"steam.init","params":{"appId":"480"}}
{"t":"req","id":2,"method":"achievements.unlock","params":{"id":"WIN"}}
{"t":"bye"}
```

A `steam_appid.txt` will appear in the directory afterwards; that is the binary
publishing its own App ID, not something you were supposed to provide.
