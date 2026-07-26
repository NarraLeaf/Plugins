//! Every Steamworks call in the bridge lives here.
//!
//! One module so that a `steamworks` crate bump — which has historically moved
//! this API around — is a diff in one file rather than a hunt through the
//! protocol loop.
//!
//! !!! THIS FILE HAS NEVER BEEN COMPILED. !!!
//! It was written without a Rust toolchain and without the Steamworks SDK (which
//! needs a Valve partner account to download). The protocol loop in main.rs is
//! ordinary Rust; the calls below are the part to check first against the pinned
//! crate version. See sidecar/README.md "Verification status" for the list.

use std::ffi::CString;
use std::path::Path;

pub struct Bridge {
    client: steamworks::Client,
    /// Set by any mutating call; cleared by `store`. Steam only commits
    /// achievements and stats — and only then draws its toast — on StoreStats.
    dirty: bool,
}

pub struct Status {
    pub available: bool,
    pub app_id: Option<String>,
    pub language: Option<String>,
}

impl Status {
    pub fn unavailable() -> Self {
        Status { available: false, app_id: None, language: None }
    }
}

impl Bridge {
    /// `SteamAPI_Init` -> `RequestCurrentStats`.
    ///
    /// `app_id` is the authored catalog's App ID, handed over by the plugin in
    /// its `steam.init` call. Publishing it is *this process's* job — see
    /// [`publish_app_id`] — because the author cannot reach the directory where
    /// it has to land, and the plugin's runtime API has no filesystem.
    ///
    /// Deliberately no `SteamAPI_RestartAppIfNecessary`: in a child process that
    /// would relaunch *the child*, which is meaningless. "Steam is not running"
    /// is simply reported as unavailable, and the game degrades to its local
    /// mirror.
    pub fn init(app_id: Option<&str>, cwd: Option<&Path>) -> Option<Bridge> {
        if let Some(app_id) = app_id {
            publish_app_id(app_id, cwd);
        }
        let client = match steamworks::Client::init() {
            Ok(client) => client,
            Err(error) => {
                // `warn`, not `info`: a shipped game drops info, and "Steam
                // never came up" is the one thing a player's log must show when
                // achievements silently stop reaching Steam.
                eprintln!("warn: SteamAPI_Init failed: {error}");
                return None;
            }
        };
        // Asks Steam for this user's current achievement and stat values. The
        // reply arrives on a callback, which the main loop is already pumping;
        // reads before it lands return defaults, which is the same answer the
        // local mirror would give.
        client.user_stats().request_current_stats();
        Some(Bridge { client, dirty: false })
    }

    pub fn run_callbacks(&self) {
        self.client.run_callbacks();
    }

    pub fn dirty(&self) -> bool {
        self.dirty
    }

    pub fn status(&self) -> Status {
        Status {
            available: true,
            app_id: Some(self.client.utils().app_id().0.to_string()),
            // Steam's own spelling ("english", "schinese"), not a BCP-47 tag.
            language: Some(self.client.apps().current_game_language().to_string()),
        }
    }

    pub fn unlock(&mut self, id: &str) -> Result<(), String> {
        self.client
            .user_stats()
            .achievement(id)
            .set()
            .map_err(|_| format!("SetAchievement({id}) failed"))?;
        self.dirty = true;
        Ok(())
    }

    /// Draws Steam's "3 / 10" progress toast. Purely cosmetic — it never unlocks
    /// anything, and Steam ignores it once the achievement is already unlocked.
    ///
    /// Routed through the raw FFI because the safe wrapper does not expose it at
    /// the pinned version. If a later `steamworks` gains an equivalent on
    /// `AchievementHelper`, prefer it and delete this block.
    pub fn indicate_progress(&mut self, id: &str, current: u32, max: u32) -> Result<(), String> {
        let name = CString::new(id).map_err(|_| "achievement id contains a NUL byte".to_string())?;
        unsafe {
            let interface = steamworks_sys::SteamAPI_SteamUserStats_v013();
            if interface.is_null() {
                return Err("ISteamUserStats is unavailable".to_string());
            }
            steamworks_sys::SteamAPI_ISteamUserStats_IndicateAchievementProgress(
                interface,
                name.as_ptr(),
                current,
                max,
            );
        }
        self.dirty = true;
        Ok(())
    }

    /// `kind` is the catalog's stat type: `int` or `float`, and nothing else.
    /// Steam's third kind, average-rate, is not in the catalog at all — it is
    /// fed through `UpdateAvgRateStat(name, countThisSession, sessionLength)`,
    /// and no node expresses a session length. See the plugin README.
    pub fn set_stat(&mut self, id: &str, kind: &str, value: f64) -> Result<(), String> {
        let stats = self.client.user_stats();
        let result = if kind == "float" {
            stats.set_stat_f32(id, value as f32)
        } else {
            stats.set_stat_i32(id, value as i32)
        };
        result.map_err(|_| format!("SetStat({id}) failed"))?;
        self.dirty = true;
        Ok(())
    }

    pub fn reset_all(&mut self, also_achievements: bool) -> Result<(), String> {
        self.client
            .user_stats()
            .reset_all_stats(also_achievements)
            .map_err(|_| "ResetAllStats failed".to_string())?;
        self.dirty = true;
        Ok(())
    }

    /// Commit. Nothing above is visible to the player — no toast, no unlocked
    /// achievement — until this runs.
    pub fn store(&mut self) -> Result<(), String> {
        self.client
            .user_stats()
            .store_stats()
            .map_err(|_| "StoreStats failed".to_string())?;
        self.dirty = false;
        Ok(())
    }
}

/// Make the App ID reachable by `SteamAPI_Init`. **Must run before it** — the
/// SDK resolves the App ID once, during init, and never looks again.
///
/// The author is deliberately not asked to do any of this. The App ID is
/// already authored in the achievement catalog, and the only place it would
/// otherwise have to be dropped by hand is the per-sidecar working directory
/// the host creates under the player's `userData` — a path no author can find,
/// and one the plugin's runtime API cannot write to (it has no filesystem). The
/// sidecar is a native process with both, so the sidecar does it.
///
/// Two mechanisms, in the order the SDK consults them:
///
/// 1. `SteamAppId` in the environment. Steam sets it itself when it launched
///    the game, and that value **wins**: it describes the app actually running,
///    which an authored field can legitimately disagree with (a test build, a
///    stale entry). We only set it when nothing was inherited.
/// 2. `steam_appid.txt` in the working directory — the documented development
///    mechanism, and the host already points our cwd at a writable folder.
fn publish_app_id(app_id: &str, cwd: Option<&Path>) {
    if let Ok(inherited) = std::env::var("SteamAppId") {
        let inherited = inherited.trim().to_string();
        if !inherited.is_empty() {
            if inherited != app_id {
                eprintln!(
                    "warn: Steam launched this game as App ID {inherited}; \
                     ignoring the catalog's {app_id}"
                );
            }
            return;
        }
    }

    let dir = match cwd {
        Some(dir) => Some(dir.to_path_buf()),
        None => std::env::current_dir().ok(),
    };
    if let Some(dir) = dir {
        let path = dir.join("steam_appid.txt");
        if let Err(error) = std::fs::write(&path, format!("{app_id}\n")) {
            eprintln!("warn: could not write {}: {error}", path.display());
        }
    }

    // Belt and braces: the file is what Valve documents, the variable is what
    // init checks first, and setting both also covers an init that resolves the
    // working directory differently from us.
    //
    // Sound here despite the stdin reader thread: that thread only moves bytes
    // between a pipe and a channel and never touches the environment, and this
    // crate is edition 2021, where `set_var` is a safe fn.
    std::env::set_var("SteamAppId", app_id);
}
