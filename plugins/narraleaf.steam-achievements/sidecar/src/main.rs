//! nl-steam-bridge — NDJSON over stdio between a NarraLeaf game and Steamworks.
//!
//! stdout is the protocol, one JSON object per line. stderr is a plain log
//! channel: the host classifies each line by a conventional level prefix
//! (`error:` / `warn:`, anything else counts as `info`) and a **shipped game
//! discards `info` outright**. Anything a player's log has to show therefore
//! carries a prefix; anything that would only be noise deliberately does not.
//!
//! Frames, protocol 1. Reconciled against the host
//! (`src/runtime/main/sidecarHost.ts`) — these names are no longer a proposal:
//!
//! ```text
//! host -> {"t":"hello","protocol":1,"pluginId":…,"sidecarId":…,"cwd":…,
//!          "mode":"preview"|"production","game":{"name":…,"version":…}}
//! us   -> {"t":"ready","protocol":1,"caps":["achievements","stats"]}
//! host -> {"t":"req","id":7,"method":"achievements.unlock","params":{"id":"WIN"}}
//! us   -> {"t":"res","id":7,"result":{…}}  |  {"t":"res","id":7,"error":{"message":"…"}}
//! us   -> {"t":"evt","method":"…","params":{…}}          (available; unused here)
//! host -> {"t":"bye"}
//! ```
//!
//! There is no `notify` frame type: a `req` **with no `id`** is the notify, and
//! it gets no reply. Correlation ids belong to the host and are always numbers,
//! so a response must echo the id it was given, unchanged.
//!
//! The host drops any single line longer than 1 MiB and resynchronises on the
//! next newline. Every frame written here is a handful of scalars, so that
//! ceiling is never approached — but it is why no method streams a payload.
//!
//! Three deliberate behaviours:
//!
//! - **stdin EOF means terminate.** It is the one shutdown signal that still
//!   arrives when the game's main process dies without running any cleanup.
//! - **A failed `SteamAPI_Init` is not a crash.** Exiting would trip the host's
//!   restart-with-backoff and spawn us twice more for nothing. Instead we answer
//!   the handshake, report `available: false`, and idle on a blocking stdin read
//!   (no callback pump, no timer, effectively zero cost) until the game quits.
//! - **Writes are committed on a debounce.** Steam shows nothing until
//!   StoreStats, and a story that unlocks three achievements in a row should not
//!   pay for three commits. Anything still pending is flushed before shutdown,
//!   so nothing is lost when the game quits mid-debounce.

mod steam;

use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};

const PROTOCOL: u32 = 1;
/// Steamworks wants its callbacks pumped often; 50ms is the usual cadence.
const TICK: Duration = Duration::from_millis(50);
/// Quiet period after the last write before committing to Steam.
const STORE_DEBOUNCE: Duration = Duration::from_millis(1000);

/// One shape for every host frame. `hello` brings `protocol` and `cwd`; `req`
/// brings `id` / `method` / `params`; `bye` brings nothing.
///
/// The handshake's `pluginId`, `sidecarId`, `mode` and `game` are ignored on
/// purpose — this process serves exactly one plugin and behaves the same in
/// preview and production. Unknown fields are skipped rather than rejected, so
/// the host can grow the handshake without breaking an already-shipped binary.
#[derive(Deserialize)]
struct Frame {
    t: String,
    #[serde(default)]
    protocol: Option<u32>,
    #[serde(default)]
    cwd: Option<String>,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    method: Option<String>,
    #[serde(default)]
    params: Option<Value>,
}

enum Input {
    Line(String),
    Closed,
}

/// What the handshake told us, plus the Steam client once there is one.
struct Session {
    /// The writable per-sidecar directory the host spawned us in, straight from
    /// the handshake. `steam_appid.txt` is written here.
    cwd: Option<PathBuf>,
    bridge: Option<steam::Bridge>,
    /// `SteamAPI_Init` is attempted exactly once. A failure is permanent for
    /// this process: the host already owns restarts with backoff, and retrying
    /// here would only stack a second, dumber loop underneath it.
    initialized: bool,
    /// When the last mutating call landed, for the store debounce.
    last_write: Option<Instant>,
}

impl Session {
    fn new() -> Session {
        Session { cwd: None, bridge: None, initialized: false, last_write: None }
    }

    /// Bring Steam up if it has not been tried yet. `app_id` is the authored
    /// catalog's, handed over by the plugin; `None` means "use whatever the
    /// environment already carries", which is the right answer when Steam
    /// launched the game itself.
    fn ensure_steam(&mut self, app_id: Option<&str>) {
        if self.initialized {
            return;
        }
        self.initialized = true;
        self.bridge = steam::Bridge::init(app_id, self.cwd.as_deref());
    }

    fn status(&self) -> Value {
        let status = self
            .bridge
            .as_ref()
            .map_or_else(steam::Status::unavailable, steam::Bridge::status);
        json!({
            "available": status.available,
            "appId": status.app_id,
            "language": status.language,
        })
    }
}

fn main() {
    let (tx, rx) = mpsc::channel::<Input>();
    thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in stdin.lock().lines() {
            match line {
                Ok(line) => {
                    if tx.send(Input::Line(line)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    eprintln!("error: stdin read failed: {error}");
                    break;
                }
            }
        }
        let _ = tx.send(Input::Closed);
    });

    let mut session = Session::new();

    loop {
        // Live: wake on the tick to pump callbacks. Not yet initialised, or
        // degraded: nothing to pump, so block until the host says something.
        let message = if session.bridge.is_some() {
            match rx.recv_timeout(TICK) {
                Ok(message) => Some(message),
                Err(mpsc::RecvTimeoutError::Timeout) => None,
                Err(mpsc::RecvTimeoutError::Disconnected) => Some(Input::Closed),
            }
        } else {
            match rx.recv() {
                Ok(message) => Some(message),
                Err(_) => Some(Input::Closed),
            }
        };

        match message {
            Some(Input::Closed) => {
                // The host went away without saying goodbye (a crash, or a kill).
                // Commit what we have rather than dropping it.
                shutdown(&mut session);
                return;
            }
            Some(Input::Line(line)) => {
                if line.trim().is_empty() {
                    // fall through to the callback pump
                } else if handle_line(&line, &mut session) {
                    shutdown(&mut session);
                    return;
                }
            }
            None => {}
        }

        let debounce_elapsed = session.last_write.map_or(false, |at| at.elapsed() >= STORE_DEBOUNCE);
        if let Some(active) = session.bridge.as_mut() {
            active.run_callbacks();
            if active.dirty() && debounce_elapsed {
                if let Err(error) = active.store() {
                    eprintln!("warn: {error}");
                }
                session.last_write = None;
            }
        }
    }
}

/// Returns true when the host asked us to stop.
fn handle_line(line: &str, session: &mut Session) -> bool {
    let frame: Frame = match serde_json::from_str(line) {
        Ok(frame) => frame,
        Err(error) => {
            eprintln!("warn: ignoring unparseable frame: {error}");
            return false;
        }
    };

    match frame.t.as_str() {
        "hello" => {
            if let Some(protocol) = frame.protocol {
                if protocol != PROTOCOL {
                    // The host compares versions itself and refuses the
                    // handshake; this makes the log say why, rather than just
                    // "did not complete the handshake".
                    eprintln!("error: host speaks protocol {protocol}, this bridge speaks {PROTOCOL}");
                }
            }
            session.cwd = frame.cwd.map(PathBuf::from);
            send(json!({
                "t": "ready",
                "protocol": PROTOCOL,
                // What this build can do, not what Steam happens to be doing
                // right now — `steam.status` answers that.
                "caps": ["achievements", "stats"],
            }));
            false
        }
        "bye" => true,
        "req" => {
            let method = frame.method.unwrap_or_default();
            let params = frame.params.unwrap_or(Value::Null);
            let result = dispatch(&method, &params, session);
            match (frame.id, result) {
                (Some(id), Ok(value)) => send(json!({ "t": "res", "id": id, "result": value })),
                (Some(id), Err(message)) => {
                    send(json!({ "t": "res", "id": id, "error": { "message": message } }))
                }
                // No id: this was a notify. There is nobody to answer, so a
                // failure is a log line and nothing else.
                (None, Err(message)) => eprintln!("warn: {method}: {message}"),
                (None, Ok(_)) => {}
            }
            false
        }
        other => {
            eprintln!("warn: ignoring unknown frame type: {other}");
            false
        }
    }
}

fn dispatch(method: &str, params: &Value, session: &mut Session) -> Result<Value, String> {
    if method == "steam.init" {
        // The plugin's first call, and the only place the App ID enters this
        // process: it lives in the authored catalog, which is renderer-side
        // data the sidecar cannot read. See `steam::Bridge::init`.
        let app_id = params
            .get("appId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        session.ensure_steam(app_id);
        return Ok(session.status());
    }

    // A no-op after the first call. Reaching it means the caller skipped
    // `steam.init`, so it still gets a real attempt — with whatever App ID the
    // environment already carries — instead of a permanent "unavailable".
    session.ensure_steam(None);

    if method == "steam.status" {
        return Ok(session.status());
    }

    let active = match session.bridge.as_mut() {
        Some(active) => active,
        // The plugin already checked the init reply before echoing anything, so
        // reaching here means the caller ignored it. Say so plainly instead of
        // pretending the write landed.
        None => return Err("Steam is not available in this process".to_string()),
    };

    let touched = match method {
        "achievements.unlock" => {
            active.unlock(&string_param(params, "id")?)?;
            true
        }
        "achievements.indicateProgress" => {
            let current = number_param(params, "current")?.max(0.0) as u32;
            let max = number_param(params, "max")?.max(0.0) as u32;
            active.indicate_progress(&string_param(params, "id")?, current, max)?;
            true
        }
        "stats.set" => {
            let kind = params
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("int")
                .to_string();
            active.set_stat(&string_param(params, "id")?, &kind, number_param(params, "value")?)?;
            true
        }
        "stats.resetAll" => {
            let also = params
                .get("alsoAchievements")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            active.reset_all(also)?;
            true
        }
        "stats.store" => {
            // Explicit flush, for callers that need the toast now. Nothing in
            // the plugin calls it today — the debounce and the shutdown flush
            // cover every path — but it is part of the surface.
            active.store()?;
            session.last_write = None;
            return Ok(json!({ "ok": true }));
        }
        other => return Err(format!("unknown method: {other}")),
    };

    if touched {
        session.last_write = Some(Instant::now());
    }
    Ok(json!({ "ok": true }))
}

fn string_param(params: &Value, key: &str) -> Result<String, String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing string parameter \"{key}\""))
}

fn number_param(params: &Value, key: &str) -> Result<f64, String> {
    params
        .get(key)
        .and_then(Value::as_f64)
        .ok_or_else(|| format!("missing number parameter \"{key}\""))
}

fn shutdown(session: &mut Session) {
    if let Some(active) = session.bridge.as_mut() {
        if active.dirty() {
            if let Err(error) = active.store() {
                eprintln!("warn: {error}");
            }
        }
    }
    // Dropping the client runs SteamAPI_Shutdown.
    session.bridge = None;
}

fn send(value: Value) {
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    if writeln!(out, "{value}").is_err() {
        return;
    }
    let _ = out.flush();
}
