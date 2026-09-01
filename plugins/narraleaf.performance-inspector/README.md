# Performance Inspector

A profiler that runs inside the game rather than beside it: frame rate and
hitches, the JavaScript heap, long tasks, every asset the run has fetched with its
bytes and decode time, and how much of that the process is still holding in memory.

**It binds no keys.** Blueprint nodes start it and open its overlay, and if you
want a key you bind one yourself — an `On Key Down` head in the game's global
blueprint takes any chord your project's input vocabulary can spell. A plugin
claiming a key in someone else's game, ahead of that game's own input routing, is
not the plugin's call to make.

It works in a **built** game, which is the point. A Dev Mode measurement is taken
against a development React and a development bundle, so it answers a different
question from the one that matters; the numbers that decide whether a player's
machine can run the game have to come from the build that reaches them.

## Turning it on

The **Performance** panel on the right rail holds every setting.

| Setting | Default | What it does |
|---|---|---|
| Overlay availability | Dev Mode only | `Dev Mode and every build` also arms previews and built games. |
| Start measuring | At game start | `When a graph says so` leaves the game untouched until `Start Profiling` runs. |
| Overlay at game start | Nothing | Start a run with the display already up, without wiring anything. |
| Compact display corner | Top left | |
| Measure asset loading | On | Sizes, request counts, decode time and retention. |
| Frame history | 60 s | How far the chart and the percentiles reach back. |
| Reports in the game log | On | |

**Availability is the setting to be deliberate about.** Left alone, the profiler
arms only in Dev Mode: nothing you build can show a player an overlay, whatever
they press. Setting it to every build makes the nodes live in the game, so turn it
back before the release build — or keep the profiling build as a separate
variant.

There is no third option for "previews but not shipped builds". A preview and a
shipped game are the same shell running the same pack, and the page cannot tell
them apart; offering the choice would promise a distinction that is not there.

## In the game

**Opening it is a node.** `Set Performance Overlay` takes `Hidden`, `Compact
display` or `Full panel`. Wire it to whatever you like: a key, a button on a debug
page, a story row at the top of the chapter you are measuring.

The two-node recipe for a key, in the game's **global** blueprint:

```
On Key Down (key: F3)  →  Set Performance Overlay (show: Compact display)
On Key Down (key: F9)  →  Start Profiling  →  Set Performance Overlay (show: Full panel)
```

`On Key Down` is a global head, so the binding works wherever the player is, and
it is your binding — spelled in the same vocabulary as every other key the project
answers to, and visible in the graph rather than buried in a plugin.

The full panel closes from its own Close button or by clicking outside it.

The compact display is transparent to the pointer and stays out of the way; the
full panel takes the pointer while it is up.

Both draw above everything, including the dialogue box and the app surfaces — the
pause menu, the save screen, any authored page. Studio renders plugin overlays
between the stage and those surfaces, which is right for an overlay belonging to
the game and wrong for a diagnostic one that would then vanish behind the first
menu the player opened, so this one is portalled to the top. Nothing else changes:
the host still owns the element, and the compact display still lets every click
through to whatever is under it.

**Overview** — frame rate, frame-time percentiles, heap, what is held in memory,
what has been loaded, and the playthrough counters.

**Frames** — the frame-time chart against the 60Hz budget, percentiles, long
tasks and total blocking time, and the profiler's own per-frame cost.

**Assets** — every address the run touched: kind, how many times it was fetched,
bytes, decode time, and whether it is still held. Sortable, filterable. An
address fetched more than once is called out, because that is usually the finding.

**Memory** — the heap over time, and everything the game is still holding through
a live object URL, broken down by kind.

**Timeline** — boot markers, scene changes, saves and restores, choices, and
whatever the story marked itself.

## Reports

The panel copies a report to the clipboard as JSON or as a written summary, and
writes it to the game log — which on a packaged build is a file on the player's
disk, and is the only sink a shipped game has that survives the process. The last
capture is also kept in plugin storage.

The written form leads with the numbers that decide whether to read the rest, and
ends with the caveats that apply to the run it describes: instrumentation that
was off, a table that hit its cap, a span still open, a counter this engine does
not expose. A measurement that overstates its own coverage is worse than no
measurement.

## Blueprint nodes

All under the `Performance` category.

| Node | Does |
|---|---|
| Start Profiling | Puts the probes in and measures from here, dropping any window already open. |
| Stop Profiling | Takes the probes back out. What was measured stays readable. |
| Set Performance Overlay | Shows the compact display, the full panel, or nothing. |
| Mark Performance Event | Drops a labelled marker on the timeline. |
| Begin / End Performance Span | Measures a named region; `End` outputs its duration. |
| Get Performance Stats | Frame rate, frame time, hitches, stalls, heap, held bytes, assets loaded. |
| Capture Performance Report | Takes a report and outputs it as a summary and as JSON. |

`Start Profiling` is also how you bound a measurement: run it at the top of the
chapter you suspect and the report describes that chapter rather than the whole
session. A window that did not see the boot says so in the report's notes, so a
bounded measurement can never read as a complete one.

`Get Performance Stats` is the one to reach for when a scene should scale itself
down on a weak machine: read the frame rate, branch, skip the expensive version.

Every node runs in every environment. Where the profiler is not armed — a built
game with availability left at Dev Mode — they do nothing and leave through their
exec pin, so a graph that measures itself keeps working in the build that is not
measuring.

`Mark`, `Begin Span` and `End Span` each take an optional wired string pin that
overrides the inspector field, so a loop can name what it is measuring.

## How it measures, and what that costs

The frame rate comes from the animation frame callback; long tasks and the
browser's own resource timing come from performance observers. With **Measure
asset loading** on, the plugin also wraps `fetch`, `XMLHttpRequest`, the two
response body readers, the object-URL factory, and both image and audio decoding.

Those wrappers always delegate first and record second, restore exactly what they
replaced, and never make a request of their own or hold a reference to a response
body. A failure on the recording side is swallowed rather than turned into a
failed asset load.

**Retention is measured through object URLs.** The engine keeps a picture alive
by keeping its object URL alive, so a URL created and never revoked is a payload
the process is still holding. That is what the memory page counts — and it is
images and video, not audio: a clip read through XHR and handed to
`decodeAudioData` becomes an audio buffer, which nothing in a page can measure.
Audio still appears in the asset table with its bytes and its decode time.

The profiler reports its own per-frame cost on the Frames page, because the first
question anyone asks a profiler is whether the numbers include the profiler.

Everything is bounded: the frame and heap histories are ring buffers, and the
address table and the timeline have caps. Whatever a cap drops is counted and
named in the report.

## What it does not collect

Nothing that identifies a player. The environment section records the user agent,
the core count, the reported device memory and the window size — the hardware a
measurement was taken on, which is the reason a report is worth sending to
someone else. No storage is read, no identifier is derived, and nothing is sent
anywhere: a report goes to the clipboard or to the game's own log, and nowhere
else.

The asset table lists what the run actually fetched, and only that. It enumerates
nothing: there is no index in the package, and an asset the game never asked for
never appears.

## Known limits

**A protected build shows opaque addresses.** Asset protection resolves by
derived id, so the address a profiled run reports is that id rather than a
filename — and so does Dev Mode, which serves assets from a grant token as
`application/octet-stream`. The sizes, counts and retention are unaffected, and
the kind is recovered from the decode: only an image element decodes an image
and only an audio context decodes audio, so anything that was decoded is
classified even when its address names nothing. An asset that was fetched and
never decoded stays `other`.

**Byte counts need the wrappers.** With **Measure asset loading** off, the only
source left is resource timing, which reports zero bytes for a response served
over a custom protocol without a timing-allow header — which is every asset in a
desktop build. The asset and memory pages say so rather than showing zeros as a
fact.

**Heap counters are Chromium-only.** Desktop builds and the web export in a
Chromium browser have them; anywhere else the memory page says the measurement is
unavailable.

**Settings are per project, not per variant.** Once `contributes.buildConfig` can
be read from a runtime entry, availability belongs there — a QA variant with the
profiler armed and a store variant without it is what build variants are for.
