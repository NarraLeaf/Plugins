# Steam achievements: declaring them, and making the game award them

Three places, and the mistake worth naming first is treating any one as another:

- **The catalog** — the API Names this project declares. That, and the App ID and the stat list, is
  all these tools write.
- **The story row or the blueprint graph** — what awards an achievement while the game runs. No
  tool here unlocks anything.
- **The Steamworks partner site** — where everything a player reads lives: the achievement's name,
  its description, its icons, whether it is hidden until unlocked. Steam draws them from there.

The catalog holds **names only**. Version 0.1 of this plugin asked for the text and icons here as
well, per language, and none of it ever reached Steam or the game, so it is no longer offered. There
is nothing in Studio that can write them and nothing here that can upload the catalog — an
achievement with no backend twin under the same API Name is a call Steam refuses at runtime. So when
you declare achievements, tell the author to enter the same names at `partner.steamgames.com` with
the words and art players see. (An entry authored under 0.1 keeps its old fields; they travel
through every edit untouched, and `list` names them under `carriedFields` rather than printing them.)

## The local mirror, and why the game works without Steam

Every read answers from a mirror in the player's save data, not from Steam. Unlocking writes the
mirror first and then echoes to Steam if it is there. So the same script runs unchanged on Steam, on
itch, in the web export and in Dev Mode — Steam absent simply means nothing is echoed.

That means you can wire up achievements and play-test them with no Steam at all. What you cannot
verify without Steam is whether the backend accepted the name.

## Tools

Every write is one undo step for the author, and anything that does not resolve refuses the whole
call and writes nothing.

- `narraleaf_steam_achievements__list {query?}` — the catalog, the App ID, and Studio's own
  author-time problems. Call it first; the others take API Names.
- `narraleaf_steam_achievements__set_app_id {appId}` — `""` clears it.
- `narraleaf_steam_achievements__add_achievements {ids}`
- `narraleaf_steam_achievements__rename_achievements {renames: [{id, newId}]}`
- `narraleaf_steam_achievements__remove_achievements {ids}`
- `narraleaf_steam_achievements__set_stats {stats}` — the **whole** list; what you leave out is gone.

An API Name is `A-Z a-z 0-9 _`, up to 44 characters, conventionally `ACH_SOMETHING` for an
achievement and a bare noun for a stat. Anything else is refused here rather than silently truncated
by Steam months later. Names are case-sensitive to Steam.

```json
{"ids": ["ACH_FIRST_CONFESSION", "ACH_ALL_ENDINGS", "ACH_SECRET_ROUTE"]}
```

```json
{"stats": [
  {"id": "EndingsSeen", "type": "int", "max": 4, "incrementOnly": true},
  {"id": "HoursPlayed", "type": "float"}
]}
```

`incrementOnly`, `min` and `max` are enforced on every write the game makes. Set the same flags in
the backend, which has its own copy of them.

## Awarding one in the game

Two ways, and they write the same mirror, so a row and a node naming the same achievement agree:

- **A story row** — `/unlock ACH_NAME` on the line where it happens. This is usually the right one:
  "the player has seen this ending" belongs on that beat, not in a graph wired to it. Typing the
  name resolves case-insensitively against the catalog, so `/unlock ach_win` lands as `ACH_WIN`; a
  name the catalog does not have is kept as typed and the row's inspector lists it as missing.
- **The Unlock Achievement blueprint node** (`narraleaf.steam-achievements.unlock`) — for a graph
  that has already worked something out. Use `blueprint_node {type: "..."}` for its pins and
  `blueprint_apply` to place it.

For the counters: **Set Stat**, **Add To Stat** and **Get Stat**. `Add To Stat` is the usual one —
`+1` per ending seen, per secret found. **Is Achievement Unlocked** is for "have they already?"
branches, and **Indicate Achievement Progress** drives Steam's "3 of 10" toast for an achievement
the *backend* has set up as a progress achievement — it does not unlock anything, so the row or
graph still unlocks when the count is reached.

`Open Store Page` and `Owns DLC` exist too. `Owns DLC` is for deciding whether to draw a purchase
button, never for gating content the player already paid for.

## The two App IDs

`set_app_id` sets the project-wide one, and that is the one the Steam connection itself is opened
with — the author never places a `steam_appid.txt`. It is read once, when the game first reaches
Steam, so a change takes effect on the next run.

Separately, a build variant can carry its own App ID, because **a demo is a different Steam app from
the game it demos**. That one is a build setting the author fills in; no tool here can reach it, and
the plugin only ever reads it from a compiled build. Mention it only if the author is shipping a
demo.

## What is deliberately missing

- **Average-rate stats.** Steam writes them with a session length no node here has, so one could
  only ever reach the mirror and never Steam. Offering a type that silently never syncs is worse
  than not offering it: pick `int` or `float`.
- **No backend export.** Achievement schemas are entered on the partner site by hand.
- **Resetting a player's achievements** exists as a node (`Reset All Stats`) for testing, not for
  scripts.
