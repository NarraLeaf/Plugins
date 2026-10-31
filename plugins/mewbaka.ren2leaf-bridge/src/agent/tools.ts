/**
 * The tools an agent porting a Ren'Py game calls through Studio's MCP endpoint. Six read, seven
 * write. Every answer opens with the notices from `collectNotices` - the only way the plugin has to
 * tell an agent something it did not ask for - and then the data.
 *
 * Descriptions are written for the model: what the tool is for, when to call it, the mistake to
 * avoid. Answers are text only; Studio does not send `data` to the agent.
 */

import type { PluginAgentToolDef, PluginAgentToolResult, PluginApp } from "narraleaf-studio/plugin";
import { advertisedName, TEST_VOICE_LEDGER, TOOL } from "../ids";
import {
    addIssues,
    addLogNote,
    askDecision,
    markSeen,
    recordConversationAnswer,
    recordLines,
    RuleError,
    upsertLedger,
    type ConversationAnswer,
    type DecisionAsk,
    type IssueInput,
    type LedgerPatch,
} from "../model";
import { caveatsForKind, caveatsForSection, type PackFacts } from "../pack/caveats";
import { KIND_SPECS, QUERY_KINDS, queryInventory, speakerDecision, type QueryKind } from "../pack/query";
import { sectionWithChildren } from "../pack/readme";
import { collectNotices, portStatus, renderAnswer, voiceSummary, type Answer } from "../status";
import { FrozenError, type BridgeStore } from "../store";
import { PAUSE_VOICE_NOTE, reconcileSummary, reconcileWithPack, type ReconcileFinding } from "../reconcile";
import { ISSUE_SEVERITIES, LEDGER_AREAS, LEDGER_STATUSES } from "../types";
import { checkVoice, type VoiceReport } from "../voice";

const SECTION_PAGE = 20_000;
const tool = (name: string) => advertisedName(name);

function refuse(code: "invalid_args" | "not_found" | "unavailable", message: string, hint?: string): PluginAgentToolResult {
    return { error: hint ? { code, message, hint } : { code, message } };
}

const NO_PACK = () => refuse(
    "unavailable",
    "No Ren2Leaf pack has been imported into this project.",
    "Stop and ask the author to import it (Ren2Leaf Bridge panel in Studio's left sidebar > Choose pack…), then call port_status again. Do not port without it, and do not ask for the pack folder instead.",
);

function str(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function int(value: unknown): number | undefined {
    return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

export async function runVoiceCheck(app: PluginApp, store: BridgeStore, scene?: string): Promise<VoiceReport> {
    const units = await app.services.voice.listUnits();
    return checkVoice(store.snapshot.lines, units, scene);
}

/** Resolve a scene by id, or by name when the name is unique. */
async function findScene(app: PluginApp, ref: string): Promise<{ id: string; name: string; storyId: string } | { error: string }> {
    const matches: { id: string; name: string; storyId: string }[] = [];
    for (const story of app.services.story.listStories()) {
        for (const scene of await app.services.story.listScenes(story.id)) {
            if (scene.id === ref) return scene;
            if (scene.name === ref) matches.push(scene);
        }
    }
    if (matches.length === 1) return matches[0]!;
    return { error: matches.length ? `"${ref}" names ${matches.length} scenes; pass the scene id.` : `No scene "${ref}".` };
}

export function createTools(app: PluginApp, store: BridgeStore): PluginAgentToolDef[] {
    const answer = (body: Answer): string => renderAnswer({ ...body, notices: collectNotices(store.snapshot) });
    /** What the caveats check, so a note about achievements stays off a game that has none. */
    const facts = (): PackFacts => ({ inventory: store.snapshot.inventory?.inventory ?? null, chapters: store.snapshot.pack?.chapters ?? null });

    /** Runs a write; rule and freeze failures become refusals the agent can act on. */
    const writing = async (work: () => Promise<PluginAgentToolResult>): Promise<PluginAgentToolResult> => {
        try {
            return await work();
        } catch (error) {
            if (error instanceof RuleError) return refuse(error.code, error.message, error.hint);
            if (error instanceof FrozenError) return refuse("unavailable", error.message);
            throw error;
        }
    };

    return [
        {
            name: TOOL.portStatus,
            title: "Port status",
            description: [
                "Where the Ren'Py port stands: the imported Ren2Leaf pack, the phase, the feature checklist by area, decisions the author has answered or still owes, recorded Studio issues, line records with a live voice check, and the last log entries.",
                "Call it first in every new session or context, before reading anything else: it is how you resume work someone (or you) started.",
                "It also tells you when there is no pack yet or the checklist is empty.",
            ].join(" "),
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            write: false,
            handler: async () => {
                let voice: VoiceReport | null = null;
                if (Object.keys(store.snapshot.lines.scenes).length) voice = await runVoiceCheck(app, store);
                return answer({ body: portStatus(store.snapshot, voice) });
            },
        },
        {
            name: TOOL.packSection,
            title: "Read a pack section",
            description: [
                "Read one section of the Ren2Leaf pack's README by its number (\"5\" for section 5 with all its subsections, \"5.3\" for one subsection). Without `section`, lists every section with its size.",
                "Rows marked 迁移者 are the migrator's settled decisions; rows from 扫描 (scan) or 引擎 (engine) are evidence to check against the source.",
                "Known errors of the pack in that section come first as # lines: read them before trusting the section.",
                "Long sections are paged: pass `cursor` from the previous answer.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    section: { type: "string", description: "Section number, e.g. \"3\", \"6.2\"." },
                    cursor: { type: "integer", minimum: 0, description: "Character offset from the previous page." },
                },
                additionalProperties: false,
            },
            write: false,
            handler: args => {
                const pack = store.snapshot.pack;
                if (!pack) return NO_PACK();
                const id = str(args.section);
                if (!id) {
                    return answer({
                        comments: [`${pack.sections.length} sections. Read one with section: "<number>".`],
                        data: pack.sections.map(section => ({ section: section.id, title: section.title, chars: section.body.length })),
                    });
                }
                const parts = sectionWithChildren(pack.sections, id);
                if (!parts.length) {
                    return refuse("not_found", `No section ${id}.`, `Sections: ${pack.sections.map(section => section.id).join(", ")}.`);
                }
                const full = parts.map(section => `${section.id === id ? "##" : "###"} ${section.id} ${section.title}\n\n${section.body}`).join("\n\n");
                const start = Math.max(0, int(args.cursor) ?? 0);
                const page = full.slice(start, start + SECTION_PAGE);
                const next = start + page.length < full.length ? start + page.length : null;
                const comments = caveatsForSection(id, pack.scanner.version, facts()).map(caveat => `Known pack error (${caveat.id}): ${caveat.text}`);
                comments.push(next === null ? `Section ${id}, characters ${start}-${full.length} of ${full.length}.` : `Section ${id}, characters ${start}-${next} of ${full.length}; next page: cursor ${next}.`);
                return answer({ comments, body: page });
            },
        },
        {
            name: TOOL.packQuery,
            title: "Query the pack's scan",
            description: [
                "Look up rows of the pack's full scan (data/inventory.json) by kind, instead of reading the whole file. Filter with `key` (the row's name: a label, a character variable, a screen…) and `file` (a script path); page with `cursor`.",
                `Kinds: ${QUERY_KINDS.join(", ")}.`,
                "Every row is static-scan evidence unless marked otherwise; speaker rows carry the migrator's decision in `migrator` when there is one, and that part is settled.",
                "Known errors of the pack for the kind come first as # lines.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    kind: { type: "string", enum: [...QUERY_KINDS] },
                    key: { type: "string", description: "Exact name to match: label name, character variable, screen name…" },
                    file: { type: "string", description: "Script path, or its tail (\"script.rpy\")." },
                    cursor: { type: "integer", minimum: 0 },
                    limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
                },
                required: ["kind"],
                additionalProperties: false,
            },
            write: false,
            handler: args => {
                const pack = store.snapshot.pack;
                const inventory = store.snapshot.inventory;
                if (!pack || !inventory) return NO_PACK();
                const kind = args.kind as QueryKind;
                const result = queryInventory(inventory.inventory, {
                    kind,
                    key: str(args.key),
                    file: str(args.file),
                    cursor: int(args.cursor),
                    limit: int(args.limit),
                });
                const rows = kind === "speaker"
                    ? result.rows.map(row => {
                        const migrator = speakerDecision(pack.speakers, row.variable);
                        return migrator ? { ...row, migrator } : row;
                    })
                    : result.rows;
                const comments = caveatsForKind(kind, pack.scanner.version, facts()).map(caveat => `Known pack error (${caveat.id}): ${caveat.text}`);
                comments.push(`${KIND_SPECS[kind].about}. Source: static scan (扫描) by ${pack.scanner.name} ${pack.scanner.version}.`);
                if (kind === "voice" && result.total === 0) {
                    comments.push("Either the game does not set config.auto_voice, or the pack was written before Ren2Leaf 0.3.0 worked the files out. Voice named by `voice` statements is on speaker rows (voiceDirs).");
                }
                comments.push(result.total === 0
                    ? "No rows match."
                    : `Rows ${(int(args.cursor) ?? 0) + 1}-${(int(args.cursor) ?? 0) + rows.length} of ${result.total}${result.nextCursor === null ? "." : `; next page: cursor ${result.nextCursor}.`}`);
                return answer({ comments, data: KIND_SPECS[kind].single ? rows[0] ?? null : rows });
            },
        },
        {
            name: TOOL.packScreen,
            title: "Read a captured screen",
            description: [
                "One screen of the original game as the migrator captured it running: every element's rectangle at 1920x1080 (x, y, w, h), its text, image file, style and defining line in the source. With `image: true`, the screenshot itself is attached, scaled to 1280 wide; the rectangles stay in 1920x1080.",
                "Style values (font size, padding, minimums) are not scaled: they are the game's own pixels, so multiply them by 1920 / the game's width, as the answer says.",
                "Without `screen`, lists the captures with their labels and the Ren'Py screens each shows. `screen` matches a capture key, its label, or a Ren'Py screen name.",
                "Use it when rebuilding an interface page: place elements from these rectangles rather than from reading screens.rpy, then compare with ui_screenshot.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    screen: { type: "string", description: "Capture key, label, or Ren'Py screen name (main_menu, say…)." },
                    image: { type: "boolean", default: false, description: "Attach the screenshot." },
                },
                additionalProperties: false,
            },
            write: false,
            handler: async args => {
                const pack = store.snapshot.pack;
                const screens = store.snapshot.screens;
                if (!pack || !screens) return NO_PACK();
                const ref = str(args.screen);
                const caveats = caveatsForKind("screen", pack.scanner.version, facts()).map(caveat => `Known pack error (${caveat.id}): ${caveat.text}`);
                if (!ref) {
                    return answer({
                        comments: [...caveats, `${pack.shots.length} captures. Read one with screen: "<key, label or screen name>".`],
                        data: pack.shots.map(shot => ({ key: shot.key, label: shot.label, screens: shot.screens, elements: shot.elementCount })),
                    });
                }
                const matches = pack.shots.filter(shot => shot.key === ref || shot.label === ref || shot.screens.includes(ref));
                if (!matches.length) return refuse("not_found", `No capture matches "${ref}".`, "Call without `screen` for the list.");
                if (matches.length > 1 && !matches.some(shot => shot.key === ref)) {
                    return answer({
                        comments: [`"${ref}" matches ${matches.length} captures; pass one key.`],
                        data: matches.map(shot => ({ key: shot.key, label: shot.label, screens: shot.screens })),
                    });
                }
                const shot = matches.find(entry => entry.key === ref) ?? matches[0]!;
                const elements = screens.shots[shot.key]?.elements ?? [];
                const width = screens.shots[shot.key]?.gameSize?.[0] ?? pack.game.width;
                const styleUnits = width && width !== 1920
                    ? `style values are the game's own pixels at ${width} wide: multiply them by ${+(1920 / width).toFixed(4)} (size 22 is ${+(22 * 1920 / width).toFixed(1)} at 1920).`
                    : width === 1920 ? "style values are in the same 1920x1080 pixels." : "style values are the game's own pixels, not scaled to 1920; the game's width is not in the pack.";
                const comments = [
                    ...caveats,
                    `Capture ${shot.key} "${shot.label}", screens: ${shot.screens.join(", ") || "?"}. ${elements.length} elements; rect is [x, y, w, h] at 1920x1080, but ${styleUnits} Source: engine (引擎), captured from the running game.`,
                ];
                const files = store.snapshot.images?.files ?? {};
                const crops = Object.entries(files).filter(([path, file]) => file.kind === "crop" && path.startsWith(`screens/${shot.key}-`));
                if (crops.length) comments.push(`Crops cut from this capture (read one with ${tool(TOOL.packImage)}): ${crops.map(([path, file]) => `${path} "${file.label}"`).join(", ")}.`);
                const result: { text: string; image?: { mimeType: "image/png" | "image/jpeg"; data: string } } = { text: "" };
                if (args.image === true) {
                    const image = files[shot.image];
                    if (image) result.image = { mimeType: image.mimeType, data: image.data };
                    else comments.push("This capture has no stored screenshot (it was missing or unreadable at import). Ask the author to re-import the pack.");
                }
                result.text = answer({ comments, data: elements });
                return result;
            },
        },
        {
            name: TOOL.packImage,
            title: "Look at a picture from the pack",
            description: [
                "A picture the pack carries, attached: a capture's screenshot, a crop the migrator cut from one, or a speaker's portrait (characters/<variable>.png).",
                "`path` is the picture's path in the pack, as the README and the other pack tools write it (screens/…, characters/…). Without it, lists every picture with its kind and label.",
                "The pack folder itself is not available to you; this is how its pictures are read. They are scaled down for viewing (screenshots to 1280 wide), so take sizes from pack_screen rectangles and assets from the game's source, not from these.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Path in the pack, e.g. characters/s.png or screens/shot-20261019-230815.png." },
                    kind: { type: "string", enum: ["screenshot", "crop", "portrait"], description: "Only list this kind." },
                },
                additionalProperties: false,
            },
            write: false,
            handler: async args => {
                if (!store.snapshot.pack) return NO_PACK();
                const files = store.snapshot.images?.files ?? {};
                const path = str(args.path);
                if (!path) {
                    const kind = str(args.kind);
                    const rows = Object.entries(files)
                        .filter(([, file]) => !kind || file.kind === kind)
                        .map(([entry, file]) => ({ path: entry, kind: file.kind, label: file.label }));
                    return answer({ comments: [rows.length ? `${rows.length} pictures. Read one with path.` : "The pack carries no pictures of that kind."], data: rows });
                }
                const file = files[path.replace(/^\.\//, "")];
                if (!file) return refuse("not_found", `The pack has no picture at ${path}.`, "Call without `path` for the list.");
                return {
                    text: answer({ comments: [`${file.kind} "${file.label}", ${path}.`] }),
                    image: { mimeType: file.mimeType, data: file.data },
                };
            },
        },
        {
            name: TOOL.voiceCheck,
            title: "Check voice against the line records",
            description: [
                "Compare the line records (lines_record) with the voice takes the project has, and list every recorded voiced line whose voice is not on its line, with the original file:line and voice file.",
                "`stale`: the scene was rewritten after its lines were recorded, so every line has a new id. Record the scene again (lines_record with replace: true, new unit ids), then link the voice.",
                "`unlinked`: the line has no take yet; link its voice file with voice_link.",
                "Call it after every story_apply of a voiced scene. Rewriting a scene silently detaches all its voice; this is how you find out.",
                "It also holds the records against the pack's own scan, per source file: say lines and voiced lines the source has vs. what you recorded. That catches a line or voice you never recorded. With a pack from Ren2Leaf 0.4.0 on, each voice statement is also checked by where it plays (a say line, or a pause or menu it must play at). Differences are not errors: explain each (extend lines merged, a file left out on purpose) or fix it.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: { scene: { type: "string", description: "Scene id, or its name when unique; all recorded scenes when omitted." } },
                additionalProperties: false,
            },
            write: false,
            handler: async args => {
                const ref = str(args.scene);
                // An id with records, or a scene found by id or name the way lines_record finds it.
                let scene = ref;
                if (ref && !store.snapshot.lines.scenes[ref]) {
                    const found = await findScene(app, ref);
                    if ("error" in found) return refuse("not_found", found.error);
                    scene = found.id;
                }
                if (scene && !store.snapshot.lines.scenes[scene]) {
                    return refuse("not_found", `No line records for scene ${ref}.`, `Record its lines with ${tool(TOOL.linesRecord)} after writing the scene.`);
                }
                const report = await runVoiceCheck(app, store, scene);
                const comments = [voiceSummary(report)];
                let pack: ReconcileFinding[] | undefined;
                if (store.snapshot.pack) {
                    // Whole project, also for one scene: a source file can span several scenes.
                    const reconciled = reconcileWithPack(store.snapshot.lines, store.snapshot.inventory?.inventory ?? null, store.snapshot.pack.chapters);
                    comments.push(reconcileSummary(reconciled));
                    if (reconciled.voice && !reconciled.statements) comments.push(PAUSE_VOICE_NOTE);
                    pack = reconciled.findings;
                }
                comments.push(`The same checks run as the Studio test ${TEST_VOICE_LEDGER}. \`problems\` are records whose voice is off its line; \`pack\` lists differences from the pack's own scan, file by file, each to be explained (warning) or noted (info).`);
                return answer({
                    comments,
                    data: {
                        problems: report.problems.slice(0, 400),
                        ...(pack ? { pack: pack.map(finding => ({ level: finding.level, code: finding.code, ...(finding.file ? { file: finding.file } : {}), text: finding.text })) } : {}),
                    },
                });
            },
        },
        {
            name: TOOL.ledgerUpsert,
            title: "Update the feature checklist",
            description: [
                "Create or update items of the port's feature checklist - the list of every feature of the original game with its porting plan, status and where it lives in Studio. The author follows it in the Ren2Leaf Bridge panel.",
                "A new item needs id (stable, e.g. \"ui.save-load\"), area, title and plan. An update needs only id and the fields that change.",
                `Areas: ${LEDGER_AREAS.join(", ")}. Statuses: ${LEDGER_STATUSES.join(", ")}.`,
                "`dropped` is refused unless decisionId names a decision the author answered: never drop a feature on your own. `blocked` needs a decisionId too.",
                "Set `where` when an item is done, so the author can check it.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                id: { type: "string" },
                                area: { type: "string", enum: [...LEDGER_AREAS] },
                                title: { type: "string" },
                                plan: { type: "string" },
                                status: { type: "string", enum: [...LEDGER_STATUSES] },
                                where: { type: "string" },
                                decisionId: { type: "string" },
                                note: { type: "string" },
                                source: {
                                    type: "array",
                                    items: { type: "object", properties: { file: { type: "string" }, line: { type: "integer" } }, required: ["file"] },
                                },
                            },
                            required: ["id"],
                        },
                    },
                },
                required: ["items"],
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const state = store.snapshot;
                const result = upsertLedger(state.ledger, state.decisions, args.items as LedgerPatch[], "agent", new Date().toISOString());
                await store.write({ ledger: result.ledger });
                return answer({
                    comments: [`Created ${result.created.length}, updated ${result.updated.length}. Checklist has ${result.ledger.items.length} items.`],
                    data: { created: result.created, updated: result.updated },
                });
            }),
        },
        {
            name: TOOL.decisionAsk,
            title: "Ask the author",
            description: [
                "Ask the author a question only they can answer (who a speaker really is, whether a feature may differ, which of two looks is right). It appears in the Ren2Leaf Bridge panel with your options and recommendation.",
                "When you are in a conversation with the author, ask them there as well: the panel is the record, not a substitute for asking. If they have already answered you there, pass their words in `answered` and the question is recorded as answered; if they answer later, record it with decision_answer.",
                "When the author is not in the conversation, do not wait for the answer: carry on with other work. The answer reaches you at the top of any later answer from this plugin, and in port_status.",
                "Give 2-4 options with their consequence, recommend one, and cite the source lines. A question you can settle yourself from the source is not one to ask.",
                "Asking the same open question twice returns the existing one.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    question: { type: "string" },
                    context: { type: "string", description: "What the author needs to know to answer." },
                    options: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: { id: { type: "string" }, label: { type: "string" }, consequence: { type: "string" } },
                            required: ["label"],
                        },
                    },
                    recommended: { type: "string", description: "Id of the option you recommend." },
                    answered: {
                        type: "object",
                        description: "The author's answer, given to you in conversation. `quote`: their own words, verbatim. `optionId` when it picks one of your options; `text` for your one-line reading of it.",
                        properties: { quote: { type: "string" }, optionId: { type: "string" }, text: { type: "string" } },
                        required: ["quote"],
                        additionalProperties: false,
                    },
                    source: {
                        type: "array",
                        items: { type: "object", properties: { file: { type: "string" }, line: { type: "integer" } }, required: ["file"] },
                    },
                },
                required: ["question"],
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const { answered, ...ask } = args as unknown as DecisionAsk & { answered?: ConversationAnswer };
                const now = new Date().toISOString();
                const result = askDecision(store.snapshot.decisions, ask, now);
                if (answered) {
                    // One write, so the panel never shows it open and the author is not told about a
                    // question they have just answered.
                    const decisions = recordConversationAnswer(result.store, result.decision.id, answered, now);
                    await store.write({ decisions });
                    return answer({
                        comments: [`Recorded as ${result.decision.id}, answered in conversation.`],
                        data: { id: result.decision.id },
                    });
                }
                if (!result.existed) await store.write({ decisions: result.store });
                return answer({
                    comments: [result.existed
                        ? `The same question is already open as ${result.decision.id}.`
                        : `Asked as ${result.decision.id}. If the author is in the conversation, ask them there too and record their reply with ${tool(TOOL.decisionAnswer)}; otherwise keep working, and the answer will come back at the top of a later answer.`],
                    data: { id: result.decision.id },
                });
            }),
        },
        {
            name: TOOL.decisionAnswer,
            title: "Record the author's answer from the conversation",
            description: [
                "Record an answer the author gave you in your conversation to an open question you asked with decision_ask, so the panel, port_status and the ledger see it answered and the author is no longer reminded of it.",
                "`quote` is the author's own words, verbatim. Record only an answer the author actually gave: never one you inferred, and never your recommendation standing in for theirs.",
                "An answer the author gave in the panel cannot be overwritten here; only the author changes it.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string", description: "The decision id, d-N." },
                    quote: { type: "string", description: "The author's words, verbatim." },
                    optionId: { type: "string", description: "The option their answer picks, if it picks one." },
                    text: { type: "string", description: "Your one-line reading of the answer, when the quote alone is unclear." },
                },
                required: ["id", "quote"],
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const { id, ...given } = args as { id: string } & ConversationAnswer;
                const decisions = recordConversationAnswer(store.snapshot.decisions, id, given, new Date().toISOString());
                await store.write({ decisions });
                return answer({ comments: [`Recorded the author's answer to ${id}.`], data: { id } });
            }),
        },
        {
            name: TOOL.decisionSeen,
            title: "Mark answers as read",
            description: "Mark the author's answers as read once you have acted on them, so they stop being repeated at the top of every answer. Pass the decision ids.",
            inputSchema: {
                type: "object",
                properties: { ids: { type: "array", items: { type: "string" } } },
                required: ["ids"],
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string") : [];
                const result = markSeen(store.snapshot.decisions, ids);
                if (result.marked.length) await store.write({ decisions: result.store });
                return answer({
                    comments: [`Marked ${result.marked.length} as read.${result.unknown.length ? ` Unknown ids: ${result.unknown.join(", ")}.` : ""}`],
                });
            }),
        },
        {
            name: TOOL.issueAdd,
            title: "Record a Studio issue",
            description: [
                "Record a problem with Studio met during the port: a tool that refused or misbehaved, a missing feature, a workaround you had to use. The author uses these to improve Studio; do not soften them.",
                "Give the tool and arguments, the exact error text, what you expected, the workaround, and severity (blocker, major, minor).",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    items: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                tool: { type: "string" },
                                args: { type: "string" },
                                error: { type: "string" },
                                expected: { type: "string" },
                                workaround: { type: "string" },
                                severity: { type: "string", enum: [...ISSUE_SEVERITIES] },
                            },
                            required: ["title"],
                        },
                    },
                },
                required: ["items"],
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const result = addIssues(store.snapshot.issues, args.items as IssueInput[], new Date().toISOString());
                await store.write({ issues: result.store });
                return answer({ comments: [`Recorded ${result.ids.join(", ")}.`] });
            }),
        },
        {
            name: TOOL.logNote,
            title: "Log a decision or phase",
            description: [
                "Keep the port's log: set the current phase (\"survey\", \"converter\", \"story\", \"interface\", \"verify\"…) and record each mapping decision with its reason, e.g. topic \"vpunch\", decision \"four camera transforms chained with delay\", reason \"a mirrored repeat ends 10px off\".",
                "The log is what lets a later session redo or extend your work without rediscovering it; port_status shows the last entries.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    phase: { type: "string" },
                    topic: { type: "string" },
                    decision: { type: "string" },
                    reason: { type: "string" },
                },
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const next = addLogNote(store.snapshot.log, args as { phase?: string; topic?: string; decision?: string; reason?: string }, new Date().toISOString());
                await store.write({ log: next });
                return answer({ comments: [`Logged. Phase: ${next.phase ?? "not set"}.`] });
            }),
        },
        {
            name: TOOL.linesRecord,
            title: "Record where lines landed",
            description: [
                "After writing a scene, record for each say line of the original where it landed: source file and line, the Studio line's unit id (its textId, the key voice uses), and the original voice file if it had one.",
                "Unit ids: localization_list {scene, language: any of the project's target languages} lists the scene's lines in reading order, each with its `id`. voice_list gives the same ids, but only once the project has a voice language.",
                "These records are what voice_check and the voice test compare against, and the only link from a Studio line back to the source.",
                "After rewriting a scene, record it again with replace: true: its lines have new ids.",
            ].join(" "),
            inputSchema: {
                type: "object",
                properties: {
                    scene: { type: "string", description: "Scene id (or its name when unique)." },
                    replace: { type: "boolean", default: false, description: "Drop the scene's previous records first." },
                    entries: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                file: { type: "string" },
                                line: { type: "integer" },
                                unitId: { type: "string" },
                                voiceFile: { type: "string", description: "Relative to the game/ folder." },
                            },
                            required: ["file", "line", "unitId"],
                        },
                    },
                },
                required: ["scene", "entries"],
                additionalProperties: false,
            },
            write: true,
            handler: args => writing(async () => {
                const ref = str(args.scene);
                if (!ref) return refuse("invalid_args", "scene is required.");
                const scene = await findScene(app, ref);
                if ("error" in scene) return refuse("not_found", scene.error);
                const entries = Array.isArray(args.entries) ? args.entries : [];
                const result = recordLines(store.snapshot.lines, scene.id, entries, args.replace === true, new Date().toISOString());
                await store.write({ lines: result.store });
                const total = result.store.scenes[scene.id]?.lines.length ?? 0;
                return answer({ comments: [`Recorded ${result.count} lines for scene "${scene.name}" (${total} in all). Run ${tool(TOOL.voiceCheck)} with scene "${scene.id}" next.`] });
            }),
        },
    ];
}
