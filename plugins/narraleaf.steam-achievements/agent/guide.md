# Steam achievements: declaring them, and making the game award them

This plugin has two halves, and the mistake worth naming first is treating one as the other:

- **The catalog** is the declaration — which achievements and stats exist, what players read, which
  icons they get. That is what these tools write.
- **The blueprint nodes** are what awards one while the game runs. No tool here unlocks anything.

There is a third place, outside Studio entirely: **the Steamworks partner site**. Steam only knows
an achievement that exists in the backend under the same API Name. The catalog does not upload
itself, and nothing in Studio can — so a catalog entry with no backend twin is a call Steam refuses
at runtime. Say so when you add achievements; the author has to enter them at
`partner.steamgames.com` under the same names.

## The local mirror, and why the game works without Steam

Every read node answers from a mirror in the player's save data, not from Steam. Unlocking writes
the mirror first and then echoes to Steam if it is there. So the same script runs unchanged on
Steam, on itch, in the web export and in Dev Mode — Steam absent simply means nothing is echoed.

That is worth knowing because it means you can wire up achievements and play-test them with no
Steam at all. `Is Achievement Unlocked` will answer correctly. What you cannot verify without Steam
is whether the backend accepted the name.

## Tools

Every write is one undo step for the author. Icons resolve by image-asset id or exact name — import
them with `assets_import` first.

- `narraleaf_steam_achievements__list {query?}` — the catalog, the App ID, the authored languages
  and Studio's own author-time problems. Call it first; the others take API Names.
- `narraleaf_steam_achievements__set_settings {appId?, locales?}`
- `narraleaf_steam_achievements__add_achievements {achievements: [...]}`
- `narraleaf_steam_achievements__update_achievements {achievements: [{id, ...}]}` — pass only what
  changes; text folds in per language, `progress: null` unbinds, `newId` renames.
- `narraleaf_steam_achievements__remove_achievements {ids}`
- `narraleaf_steam_achievements__set_stats {stats: [...]}` — the **whole** list; what you leave out
  is gone.

An API Name is `A-Z a-z 0-9 _`, up to 44 characters, conventionally `ACH_SOMETHING` for an
achievement and a bare noun for a stat. Anything else is refused here rather than silently
truncated by Steam months later.

```json
{"achievements": [
  {"id": "ACH_FIRST_CONFESSION",
   "name": {"en": "First words", "zh-CN": "第一次告白"},
   "description": {"en": "You said it out loud.", "zh-CN": "你终于说出口了"},
   "iconAchieved": "ach_confession.png"},
  {"id": "ACH_ALL_ENDINGS", "name": "Completionist", "hidden": true,
   "progress": {"stat": "EndingsSeen", "max": 4}}
]}
```

A bare string lands in the catalog's first language; the object form names locales outright. Declare
the stat (`set_stats`) before an achievement binds progress to it — a binding to a stat that does
not exist is refused.

## Awarding one in the game

In an event graph, after whatever earns it:

- **Unlock Achievement** (`narraleaf.steam-achievements.unlock`) — its `Achievement` field is the
  API Name. This is the only thing that awards an achievement.
- **Indicate Achievement Progress** — shows Steam's "3 of 10" toast. It needs an achievement whose
  `progress` is bound to a stat; it does *not* unlock anything, so the graph still calls
  **Unlock Achievement** when the count reaches `max`.
- **Set Stat** / **Add To Stat** / **Get Stat** — the counters. `Add To Stat` is the usual one:
  `+1` per ending seen, per secret found.
- **Is Achievement Unlocked** — for "have they already?" branches.

Use `blueprint_node {type: "narraleaf.steam-achievements.unlock"}` for the pins, and
`blueprint_apply` to place it. A progress achievement is normally three nodes in a row: add to the
stat, indicate progress, then unlock when the stat reaches `max`.

## The two App IDs

`set_settings {appId}` sets the project-wide App ID, and that is the one the Steam connection itself
is opened with — the author never places a `steam_appid.txt`. It is read once, when the game first
reaches Steam, so changing it mid-session does nothing until a reload.

Separately, each build variant can state its own App ID in the build config, because **a demo is a
different Steam app from the game it demos**. That one is used for store-page links, and falls back
to the catalog's when a variant states nothing. Setting the catalog's App ID is enough for a single
release; mention the build config only if the author is shipping a demo.

## What is deliberately missing

- **Average-rate stats.** Steam's third stat kind is written with a session length no node here has,
  so it could only ever reach the mirror and never Steam. Offering a type that silently never syncs
  is worse than not offering it.
- **Resetting a player's achievements** exists as a node (`Reset All`) for testing, not for scripts.
