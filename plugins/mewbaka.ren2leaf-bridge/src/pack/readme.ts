/**
 * Reading the pack's README: cut it at its numbered headings, and pull the screenshot table out of
 * section 6. The README is written for an agent and stays the pack's authority; this only makes it
 * addressable one section at a time.
 */

import type { ReadmeSection, ShotIndexEntry } from "../types";

// `## 5　流程与章节`, `### 5.3　流程事实`. Ren2Leaf separates number and title with U+3000.
const HEADING = /^(#{2,3})[ \t]+(\d+(?:\.\d+)*)[ \t　]+(.+?)\s*$/;

export function splitReadme(text: string): ReadmeSection[] {
    const sections: ReadmeSection[] = [];
    let current: ReadmeSection = { id: "title", title: "", body: "" };
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const body: string[] = [];
    const flush = () => {
        current.body = body.join("\n").trim();
        if (current.id !== "title" || current.body || current.title) sections.push(current);
        body.length = 0;
    };
    let inFence = false;
    for (const line of lines) {
        if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
        const match = inFence ? null : HEADING.exec(line);
        if (match) {
            flush();
            current = { id: match[2]!, title: match[3]!, body: "" };
            continue;
        }
        if (current.id === "title" && !current.title && /^#\s+/.test(line)) {
            current.title = line.replace(/^#\s+/, "").trim();
            continue;
        }
        body.push(line);
    }
    flush();
    return sections;
}

/** A section and everything numbered under it: `"5"` takes 5, 5.1, 5.2 …; `"5.1"` takes 5.1 and 5.1.x. */
export function sectionWithChildren(sections: ReadmeSection[], id: string): ReadmeSection[] {
    return sections.filter(section => section.id === id || section.id.startsWith(`${id}.`));
}

const SHOT_LINK = /\]\((screens\/([^)\s]+?)\.png)\)/;

/**
 * The screenshot table at the top of section 6: one row per capture, naming the migrator's label,
 * the Ren'Py screens it shows and the picture.
 */
export function parseShotTable(sections: ReadmeSection[]): Omit<ShotIndexEntry, "elementCount">[] {
    const six = sections.find(section => section.id === "6");
    if (!six) return [];
    const shots: Omit<ShotIndexEntry, "elementCount">[] = [];
    for (const line of six.body.split("\n")) {
        const link = SHOT_LINK.exec(line);
        if (!link || !line.trim().startsWith("|")) continue;
        const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
        const label = cells[0] ?? "";
        const screens = (cells[1] ?? "")
            .split(/[、,，]/)
            .map(name => name.trim())
            .filter(name => name && name !== "—");
        shots.push({ key: link[2]!, label, screens, image: link[1]! });
    }
    return shots;
}
