# Ren2Leaf Bridge

Brings a [Ren2Leaf](https://github.com/MewBaka/Ren2Leaf) pack into a NarraLeaf Studio project, so
the agent porting a Ren'Py game reads the pack, records its progress and asks the author through
Studio.

The plugin ports nothing itself. The port is done by an agent following the `narraleaf-port-renpy`
skill (shipped with Ren2Leaf) through Studio's MCP endpoint; that skill stops until this plugin is
installed and a pack is imported. The plugin gives the agent three things:

- **The pack, a piece at a time.** README sections, rows of the full scan, captured screens with
  element rectangles, and the pack's pictures, each through its own tool. Known mistakes of the
  scanner version that wrote the pack come back at the top of the rows they affect.
- **Line records.** Where each original line landed in Studio and which voice file it carries, so a
  scene rewrite that silently detaches voice is caught at once. The records are also held against
  the pack's own scan, file by file, so a line or a voice that was never recorded shows up too.
- **State that outlives a context window.** The feature checklist, the author's decisions, the
  mapping log and Studio issues live in the project, under version control. A new session resumes
  from `port_status`.

Studio entry only; nothing ships with the game.

## Using it

1. Install Ren2Leaf Bridge from the Store in Studio's Plugins page and enable it.
2. In the project you are porting into, open the Ren2Leaf Bridge panel in the left sidebar and
   choose the folder Ren2Leaf exported. Its data and pictures (scaled down) are copied into the
   project; the folder is not read again. Re-import after exporting a new pack.
3. Give the agent the Ren'Py source and the prompt from Ren2Leaf's README. Do not give it the
   pack folder: it reads the pack through this plugin.

The panel has four tabs: overview (the pack and progress by area), decisions (answer the agent's
questions), checklist (accept or send back finished items) and issues (Studio problems the agent
recorded, copyable as Markdown). While the agent's questions wait for an answer, the panel's icon in
the sidebar carries a dot and its title the count, and opening the project says how many are open.

## Agent tools

| Tool | Writes | What for |
| --- | --- | --- |
| `port_status` | no | Where the port stands; the first call of every session |
| `pack_section` | no | One section of the pack's README |
| `pack_query` | no | Rows of the full scan, by kind |
| `pack_screen` | no | A captured screen's element rectangles and crops, optionally the screenshot |
| `pack_image` | no | A picture from the pack: screenshot, crop or speaker portrait |
| `voice_check` | no | Recorded voiced lines whose voice is no longer on the line; per-file differences from the pack's scan |
| `ledger_upsert` | yes | Add to or update the feature checklist |
| `decision_ask` | yes | Ask the author a question |
| `decision_seen` | yes | Mark answers as read |
| `issue_add` | yes | Record a Studio problem |
| `log_note` | yes | Record a phase change or a mapping decision |
| `lines_record` | yes | Record where a scene's original lines landed |

MCP clients see them as `mewbaka_ren2leaf_bridge__<tool>`. How they fit together is in
[`agent/guide.md`](agent/guide.md), which agents read as
`agent_guide {chapter: "plugin:mewbaka.ren2leaf-bridge"}`.

The test `mewbaka.ren2leaf-bridge.voice-ledger` runs the same check as `voice_check` and fails on
any recorded voiced line without its voice. Differences from the pack's scan (say lines and voiced
lines per source file) are reported as warnings and notes, not failures: merging `extend` lines or
leaving out an unreachable file changes the counts on purpose.

## Development

```bash
corepack enable && yarn install
yarn typecheck
yarn test
yarn build
```
