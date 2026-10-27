/**
 * The Run > Test check the author (or an agent, through Studio's `test` tool) runs: every recorded
 * voiced line still has its voice. Headless and needs nothing from the host beyond what the plugin
 * already has.
 */

import type { PluginApp, PluginTranslator, TestDefinition, TestFinding } from "narraleaf-studio/plugin";
import { runVoiceCheck } from "./agent/tools";
import { TEST_VOICE_LEDGER } from "./ids";
import type { BridgeStore } from "./store";
import type { VoiceProblem } from "./voice";

export function voiceLedgerTest(app: PluginApp, store: BridgeStore, t: PluginTranslator): TestDefinition {
    const sceneTargets = async (): Promise<Map<string, { storyId: string; storyName: string; sceneName: string }>> => {
        const map = new Map<string, { storyId: string; storyName: string; sceneName: string }>();
        for (const story of app.services.story.listStories()) {
            for (const scene of await app.services.story.listScenes(story.id)) {
                map.set(scene.id, { storyId: story.id, storyName: story.name, sceneName: scene.name });
            }
        }
        return map;
    };

    const finding = (problem: VoiceProblem, where: Map<string, { storyId: string; storyName: string; sceneName: string }>): TestFinding => {
        const scene = where.get(problem.sceneId);
        const params = { source: `${problem.file}:${problem.line}`, voice: problem.voiceFile };
        const result: TestFinding = {
            severity: "error",
            ruleId: `ren2leaf-bridge/voice-${problem.kind}`,
            message: { text: t.t(problem.kind === "stale" ? "test.voice.stale" : "test.voice.unlinked", params) },
            englishMessage: problem.kind === "stale"
                ? `${params.source}: the scene was rewritten after its lines were recorded, so ${params.voice} is on a line that no longer exists. Record the scene again, then link the voice.`
                : `${params.source}: ${params.voice} is not linked to its line.`,
        };
        if (scene) {
            result.target = { kind: "storyScene", storyId: scene.storyId, sceneId: problem.sceneId, storyName: scene.storyName, sceneName: scene.sceneName };
        }
        return result;
    };

    return {
        id: TEST_VOICE_LEDGER,
        title: { text: t.t("test.voice.title") },
        description: { text: t.t("test.voice.description") },
        category: "integrity",
        presentation: "headless",
        checkAvailability: () => Object.keys(store.snapshot.lines.scenes).length
            ? { available: true }
            : { available: false, reason: { text: t.t("test.voice.noRecords") } },
        run: async ctx => {
            const report = await runVoiceCheck(app, store);
            const where = await sceneTargets();
            for (const problem of report.problems) ctx.report(finding(problem, where));
            if (report.strayTakes) {
                ctx.report({
                    severity: "warning",
                    ruleId: "ren2leaf-bridge/voice-stray",
                    message: { text: t.t("test.voice.stray", { count: report.strayTakes }) },
                    englishMessage: `${report.strayTakes} voice takes sit on lines that no longer exist.`,
                });
            }
            const summary = { text: t.t("test.voice.summary", { linked: report.linked, total: report.voicedLines }) };
            return report.problems.length ? { status: "failed", summary } : { status: "passed", summary };
        },
    };
}
