# Ren2Leaf Bridge

Ren2Leaf Bridge holds a Ren'Py port's state inside the Studio project: the Ren2Leaf pack the
migrator exported, the feature checklist, the questions for the author, the log, Studio issues
and where each original line landed. It does not port anything itself. The porting method is
the `narraleaf-port-renpy` skill; this chapter is how its tools fit into that method.

Tool names below are as your client lists them (`mewbaka_ren2leaf_bridge__<tool>`).

## Start of every session

1. `port_status`. It says whether a pack is imported, the phase, what is done, what the author
   answered, and the last log entries. A new context resumes from here, not from memory.
2. No pack: stop. Ask the author to import it (the Ren2Leaf Bridge panel in Studio's left
   sidebar > Choose pack…) and wait. Do not port without it, and do not ask for the pack folder
   instead: the pack is read through this plugin only.
3. Empty checklist: survey the game, then write every feature of the original with
   `ledger_upsert` before converting anything. The author reads this list.

## Reading the pack

- `pack_section {section}` reads one README section; without it, the list of sections.
- `pack_query {kind, key?, file?}` reads rows of the full scan: speakers, labels, endings,
  screens, python, variables, achievements… Ask for what you need instead of reading
  `inventory.json` whole. Where the README says a cut table continues in `data/inventory.json`
  or `data/speakers.json`, this is how you read the rest. Kind `voice` lists each line's voice
  file when the game sets `config.auto_voice` (packs from Ren2Leaf 0.3.0 on).
- `pack_screen {screen, image?}` gives a captured screen's element rectangles at 1920x1080,
  the crops cut from it, and the screenshot with `image: true`. Build interface pages from these
  rectangles. Style values (font size, padding) are not scaled: they are the game's own pixels,
  and the answer says what to multiply them by.
- `pack_image {path}` shows any picture the pack carries: screenshots, crops, and speaker
  portraits (`characters/<variable>.png`). The README links pictures by these paths. They are
  scaled down for viewing; real assets come from the game's source.
- Lines starting `# Known pack error` are mistakes Ren2Leaf is known to make in that section
  or kind, for the Ren2Leaf version that wrote the pack: ones a later Ren2Leaf fixed drop out,
  ones still open stay on. Check them against the source before relying on the rows.
- Rows marked 迁移者 are the migrator's decisions and are settled. Rows from 扫描 (scan) and
  引擎 (engine) are evidence.

## While porting

- After every `story_apply` of a scene with dialogue: `lines_record {scene, entries}` with each
  say line's source file:line, the Studio line's unit id and its voice file, then
  `voice_check {scene}`. The unit ids are the `id`s `localization_list {scene, language}` lists
  in reading order, for any of the project's target languages; `voice_list` has them too, but
  only once the project has a voice language. Rewriting a scene gives every line a new id and
  silently detaches its voice; `voice_check` is how you see it. Re-record with `replace: true`
  after a rewrite.
- `voice_check` and `port_status` also hold the records against the pack's own scan, per source
  file: the say lines and voiced say lines Ren2Leaf found, against the lines you recorded and
  those carrying a voice file. This is what catches a line or a voice you never recorded. A
  difference is not an error, but each needs a reason: an `extend` merged into the line before
  is -1, a merge split back into two rows +1, a file the migrator excluded or the game cannot
  reach may be left out on purpose (log why). Anything else is a lost, doubled or misplaced line.
  A pack from Ren2Leaf 0.4.0 on also lists every `voice` statement with where it plays, and each
  is checked by itself: a voice for a say line that no record carries, one that plays during a
  `pause` or a `menu` (play it there, not on the next line), one the original never plays. In
  older packs voices that play during a pause or a menu are in neither count: find them in the
  source.
- A question only the author can answer: `decision_ask` with options and a recommendation. If
  the author is in your conversation, ask them there as well - the panel keeps the question and
  its answer across sessions, it does not replace asking. When they answer you there, record it:
  `answered {quote, optionId?}` on `decision_ask` if they already have, or `decision_answer {id,
  quote}` later. `quote` is their own words; record only an answer they gave. If the author is
  not in the conversation, carry on with other work: answers given in the panel come back at the
  top of later answers from this plugin; act on them, then `decision_seen`.
- Never drop a feature yourself. `ledger_upsert` refuses `dropped` without an answered decision.
- Record each mapping decision with `log_note {topic, decision, reason}` and each phase change
  with `log_note {phase}`. Record Studio problems with `issue_add`, exactly as they happened.
- When an item is done, set `status: "done"` and `where`. The author may send it back; the
  notice says why.

## Checking

- `test {id: "mewbaka.ren2leaf-bridge.voice-ledger"}` runs the voice check as a Studio test
  and fails on any recorded voiced line without its voice. Differences from the pack's scan come
  with it as warnings and notes; they do not fail the test.
