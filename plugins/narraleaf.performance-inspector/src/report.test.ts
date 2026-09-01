import { describe, expect, it } from "vitest";
import { PerformanceCollector } from "./collector";
import { buildReport, formatBytes, formatMs, formatReportJson, formatReportText } from "./report";

function collectorWith(work: (collector: PerformanceCollector) => void): PerformanceCollector {
    let now = 0;
    const collector = new PerformanceCollector({
        historySeconds: 60,
        startedAtEpochMs: 1_700_000_000_000,
        now: () => now,
    });
    work(collector);
    // `now` is deliberately never advanced: every relative time in these reports is zero, which is
    // what makes two captures of the same session byte-identical.
    void now;
    return collector;
}

function reportFrom(collector: PerformanceCollector) {
    return buildReport({
        snapshot: collector.snapshot(),
        environment: { platform: "Win32", shell: "nlgame:" },
        pluginVersion: "0.1.0",
        capturedAtEpochMs: 1_700_000_060_000,
    });
}

describe("formatBytes", () => {
    it("scales and rounds so a table column stays narrow", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(15 * 1024 * 1024)).toBe("15.0 MB");
    });
});

describe("formatMs", () => {
    it("changes unit rather than printing six digits of milliseconds", () => {
        expect(formatMs(12.4)).toBe("12ms");
        expect(formatMs(1500)).toBe("1.50s");
        expect(formatMs(125_000)).toBe("2m 5s");
    });
});

describe("buildReport", () => {
    it("orders the asset table heaviest first", () => {
        const collector = collectorWith(instance => {
            instance.request({ url: "small.png", durationMs: 1, bytes: 100 });
            instance.request({ url: "huge.png", durationMs: 1, bytes: 100_000 });
            instance.request({ url: "medium.png", durationMs: 1, bytes: 5_000 });
        });
        const report = reportFrom(collector);
        expect(report.resources.entries.map(entry => entry.url)).toEqual([
            "huge.png",
            "medium.png",
            "small.png",
        ]);
    });

    it("says so when instrumentation was off rather than reporting zero bytes as a fact", () => {
        const collector = collectorWith(() => undefined);
        const report = reportFrom(collector);
        expect(report.notes.some(note => note.includes("Asset instrumentation was off"))).toBe(true);
    });

    it("names the addresses the cap refused", () => {
        let now = 0;
        const collector = new PerformanceCollector({
            historySeconds: 60,
            startedAtEpochMs: 0,
            now: () => now,
            maxAddresses: 1,
        });
        collector.setInstrumented(true);
        collector.request({ url: "a.png", durationMs: 1, bytes: 1 });
        collector.request({ url: "b.png", durationMs: 1, bytes: 1 });
        now += 1;
        const report = reportFrom(collector);
        expect(report.resources.droppedAddresses).toBe(1);
        expect(report.notes.some(note => note.includes("address table hit its cap"))).toBe(true);
    });

    it("names spans left open, so a missing one is not read as a missing measurement", () => {
        const collector = collectorWith(instance => {
            instance.setInstrumented(true);
            instance.beginSpan("chapter 1");
        });
        const report = reportFrom(collector);
        expect(report.openSpans).toEqual(["chapter 1"]);
        expect(report.notes.some(note => note.includes("chapter 1"))).toBe(true);
    });
});

describe("formatReportText", () => {
    it("carries every section a reader looks for", () => {
        const collector = collectorWith(instance => {
            instance.setInstrumented(true);
            instance.frame(0);
            instance.frame(16);
            instance.frame(32);
            instance.request({ url: "nlgame://asset/bg/room.png", durationMs: 12, bytes: 250_000 });
            instance.retain("blob:1", "nlgame://asset/bg/room.png", 250_000);
            instance.count("dialogueLines", 40);
            instance.mark("boot", "first scene ready");
        });
        const text = formatReportText(reportFrom(collector));
        for (const heading of ["FRAMES", "MEMORY", "ASSETS LOADED", "PLAYTHROUGH", "TIMELINE", "ENVIRONMENT"]) {
            expect(text).toContain(heading);
        }
        expect(text).toContain("nlgame://asset/bg/room.png");
        expect(text).toContain("first scene ready");
    });

    it("is a pure function of the snapshot, so two captures of one session agree", () => {
        const collector = collectorWith(instance => {
            instance.setInstrumented(true);
            instance.request({ url: "a.png", durationMs: 3, bytes: 10 });
        });
        const first = formatReportText(reportFrom(collector));
        const second = formatReportText(reportFrom(collector));
        expect(first).toBe(second);
    });
});

describe("formatReportJson", () => {
    it("round-trips", () => {
        const collector = collectorWith(instance => {
            instance.setInstrumented(true);
            instance.request({ url: "a.png", durationMs: 3, bytes: 10 });
        });
        const report = reportFrom(collector);
        const parsed = JSON.parse(formatReportJson(report));
        expect(parsed.format).toBe(report.format);
        expect(parsed.resources.entries[0].url).toBe("a.png");
    });
});
