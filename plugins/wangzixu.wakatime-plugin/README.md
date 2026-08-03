# WakaTime

Reports the time you spend authoring a project in NarraLeaf Studio to
[WakaTime](https://wakatime.com).

The whole plugin is **one icon button** beside the Run control, opening a dialog
with three settings: an on/off switch, your API key, and the project name.
Nothing else is added to the workspace — no rail icon, no panel, no menu.

Editor-side only. There is no `runtime` entry, no blueprint node and no widget:
nothing this plugin does reaches a shipped game.

## Why a button and not a Settings page

Because a plugin cannot reach the Settings window. A studio entry loads in the
**workspace window only** — never Launcher, Settings, Project Wizard or Dev Mode
— and `PluginServices` has no settings contribution point, in the published
`narraleaf-studio@0.5.0` types or in Studio's current source. A standalone
registered action, which Studio draws as a single icon button next to Run, is the
lightest surface the plugin API actually has.

The dialog mounts its own React root (`react-dom/client` is published to plugins
through the workspace import map for exactly this). Studio's `ui` kit reads its
translations from a module store rather than a React provider, so `ui.Modal` and
the inputs render there identically. The one thing that does need workspace
context — `ui.useFreezeGuard` — is replaced by the documented service half,
`services.workspace.frozen` / `onFreezeChange`.

## What it sees, and what it does not

Studio's plugin API has no editing signal — no "document changed", no "the active
editor is now this scene", no save hook. What a studio entry *does* have is the
workspace window's DOM, so that is what the tracker reads: keystrokes, clicks,
wheel and IME commits, in the capture phase, for their **timing only**. No key,
no coordinate and no target element is inspected, stored or sent.

| WakaTime concept | What this plugin reports |
| ---------------- | ------------------------ |
| Project          | The name you type in the dialog. |
| Entity / file    | `NarraLeaf Studio`, always. The active document is not knowable through the plugin API, and a guessed file path would be a lie the dashboard cannot tell from a fact. |
| Language         | `NarraLeaf`, fixed. |
| Category         | `designing`, fixed. |
| Branch, lines, cursor | Not sent. |

So: correct per-project totals, correct per-day totals, no per-file breakdown.

**The project name has to be typed.** There is no project name or project path
anywhere in `PluginServices`, the workspace title bar is a hardcoded
`"NarraLeaf Studio"`, and no DOM element carries it — so there is nothing to read
it from. It is asked once per project and then versioned with the project, which
also means collaborators inherit it instead of each inventing their own.

## What leaves your machine

One `POST` to `…/users/current/heartbeats.bulk` per two minutes of activity, each
heartbeat carrying: the project name you chose, the fixed category and language
labels, a timestamp, the constant entity string above, and the plugin's
user-agent. **No story text, no scene or asset names, no file paths, no
keystrokes.** `buildHeartbeat` in `src/wakatime.ts` is the whole payload, and a
test asserts its field list so it cannot quietly grow.

Nothing is sent at all until the switch is on *and* an API key is entered *and*
the project is named.

## Where the API key lives

**In the workspace window's `localStorage`, not in the project.**

`app.services.storage` — the storage a Studio plugin is handed — writes into
`editor/services/`, inside the project's versioned working tree: the same tree
you commit and push. A credential written there is a credential in your
repository, and on a public repository that is a leak with no undo. So the key
and the on/off switch are machine-scoped and live outside the project; only the
project name is project data.

It is plaintext, which is exactly what `~/.wakatime.cfg` is. Studio exposes no
secret store to plugins, so the real choice here is not "encrypted or plaintext"
but "outside the project or in git".

## Offline

Heartbeats go into a local queue and are flushed in batches of 25, retried once a
minute. Being offline, or the server being down or rate-limiting, keeps the
queue; only a response that will never become valid drops a batch. A rejected
**API key** parks sending entirely rather than retrying forever, and raises one
notification so a plugin with no permanent UI does not fail silently — changing
the key resumes it.

The queue holds 1000 heartbeats, about 33 hours of unsent work, and drops its
oldest entries first.

Editor plugins normally get all of this for free by shelling out to
`wakatime-cli`. This one cannot: Studio's privileged facade exposes
`bash.execute`, but the main process handler answers *"Bash execution is not
implemented yet"*. So the plugin speaks the documented HTTP API directly and
reimplements the queue.

## Permissions

`"permissions": []` — none.

Network access is not a declared Studio permission: a studio entry runs in the
workspace renderer and uses `fetch` like any other renderer code. The two
endpoints used here (`heartbeats.bulk`, `statusbar/today`) were checked against
api.wakatime.com and pass a CORS preflight with an `Authorization` header.
`GET /users/current` does **not** — it answers its error responses without
`Access-Control-Allow-Origin` — which is why the dialog's **Test** button calls
`statusbar/today` instead.

Only wakatime.com is supported. A self-hosted server (Wakapi, Hackatime) would
need a fourth setting, and three is the budget.

## Setting it up

1. **Launcher → Plugins → Install from folder**, then approve and enable it.
2. Click the timer icon beside the Run button — or type **WakaTime** in the
   command palette. (An icon-only action carries a tooltip rather than a label,
   and the palette falls back to it, so the button is reachable by name.)
3. Click the `wakatime.com/settings/api-key` address under the key field to copy
   it, open it in your browser, and paste the key back. Name the project, leave
   the switch on.
4. **Test** — it records one heartbeat, sends it, and reports today's total, so a
   success there means the write path works and not just the key.

That address copies rather than opens, because a plugin cannot open a browser:
the workspace window denies every `setWindowOpenHandler` request and blocks
`will-navigate` to anything outside its own entry, and `shell.openExternal` sits
behind an IPC the plugin facade does not carry. An `<a href>` there would be a
control that visibly does nothing.

The switch defaults to on, which is safe because it is inert: with no key and no
project name, nothing is recorded and nothing is sent.

## Frozen projects

While Studio's version control has the project frozen — restoring a past version,
or showing one read-only — every plugin toolbar action is disabled by Studio
itself (the exemption list is a table in Studio's source, not a flag a plugin can
set), so the button cannot be opened until the project thaws. If a freeze begins
while the dialog is open, the project-name field greys out and its write bails
before touching memory; the key and the switch stay live, because they are not
project data. The store re-reads through `registerReloader` after a restore.

The tracker keeps running while frozen. Time spent reading an old version is
still time spent on the project.

## Files

| File                   | Purpose |
| ---------------------- | ------- |
| `src/wakatime.ts`      | The wire format and the HTTP client. No Studio types, no DOM. |
| `src/settings.ts`      | The three settings' shapes, normalization, and the `localStorage` half. |
| `src/projectStore.ts`  | The project-storage half: freeze bail-out and reloader. |
| `src/tracker.ts`       | Activity detection, heartbeat rhythm, queue flushing. |
| `src/i18n.ts`          | The dialog's own messages (`en`, `zh`). |
| `src/main.tsx`         | Studio entry: the action, the dialog and its root, and the wiring. |
| `tools/make-icon.mjs`  | Renders `icon.png` — a line-art stopwatch, drawn here rather than downloaded. |

## The icon

`icon.png` is generated by `yarn icon`, and it is **not WakaTime's logo**. A
plugin icon is the most prominent brand slot a package has, and this one is
published by someone other than WakaTime — their mark on it would read as an
official integration, which this is not. The plugin's *name* says WakaTime,
which is ordinary descriptive use of the service it talks to, and that is where
the association belongs. `narraleaf.steam-achievements` made the same call about
Valve's logo.

The drawing is a stopwatch, matching the lucide `Timer` the plugin puts on the
toolbar, so the thumbnail and the button are the same idea. Studio requires a
square PNG/WebP/JPEG between 64x64 and 512x512 and under 512 KB; this ships at
256x256 and about 6 KB. Render it at the size a list actually shows with
`node tools/make-icon.mjs icon.png --size=64`.

## Scripts

```bash
yarn build       # bundle to dist/
yarn dev         # same, unminified with sourcemaps
yarn test        # vitest
yarn typecheck   # tsc --noEmit
```
