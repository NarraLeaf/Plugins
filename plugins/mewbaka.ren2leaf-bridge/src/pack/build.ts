/**
 * Turning the files of a Ren2Leaf pack into what the plugin stores. Pure: the importer reads the
 * files and hands them over, so everything here runs in a unit test.
 */

import type {
    Decision,
    InventoryStore,
    PackStore,
    ScreenElement,
    ScreensStore,
    ShotIndexEntry,
} from "../types";
import { parseShotTable, splitReadme } from "./readme";

/** Inventory schema versions this release reads. Ren2Leaf 0.2.0 writes 2. */
export const SUPPORTED_SCHEMA = { min: 1, max: 2 } as const;

export type RawPack = {
    sourcePath: string;
    readme: string;
    inventory: unknown;
    speakers: unknown;
    chapters: unknown;
    /** `data/screens/*.elements.json`, already parsed, keyed by file name. */
    elements: { fileName: string; json: unknown }[];
};

export type BuiltPack = {
    pack: PackStore;
    inventory: InventoryStore;
    screens: ScreensStore;
    /** The migrator's decisions from the pack, as read-only decision rows. */
    decisions: Decision[];
};

export class PackError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
}

function num(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function buildPack(raw: RawPack, now: string): BuiltPack {
    const inventory = raw.inventory;
    if (!isRecord(inventory)) {
        throw new PackError("data/inventory.json is not a JSON object.");
    }
    const schemaVersion = num(inventory.schemaVersion);
    if (schemaVersion === null) {
        throw new PackError("data/inventory.json has no schemaVersion; this does not look like a Ren2Leaf pack.");
    }
    if (schemaVersion < SUPPORTED_SCHEMA.min || schemaVersion > SUPPORTED_SCHEMA.max) {
        throw new PackError(
            `The pack's inventory is schema ${schemaVersion}; this version of Ren2Leaf Bridge reads ${SUPPORTED_SCHEMA.min}-${SUPPORTED_SCHEMA.max}. Update the plugin.`,
        );
    }
    const scanner = isRecord(inventory.scanner) ? inventory.scanner : {};
    const game = isRecord(inventory.game) ? inventory.game : {};
    const resolution = isRecord(game.resolution) ? game.resolution : {};

    const sections = splitReadme(raw.readme);
    const elementsByKey = new Map<string, Record<string, unknown>>();
    for (const { fileName, json } of raw.elements) {
        if (!isRecord(json)) continue;
        const key = str(json.key) ?? fileName.replace(/\.elements\.json$/, "");
        elementsByKey.set(key, json);
    }

    const shots: ShotIndexEntry[] = [];
    const seen = new Set<string>();
    for (const shot of parseShotTable(sections)) {
        const elements = elementsByKey.get(shot.key)?.elements;
        shots.push({ ...shot, elementCount: Array.isArray(elements) ? elements.length : 0 });
        seen.add(shot.key);
    }
    // A capture the README table does not list still has its elements; keep it findable by key.
    for (const [key, json] of elementsByKey) {
        if (seen.has(key)) continue;
        const item = isRecord(json.item) ? json.item : {};
        shots.push({
            key,
            label: str(item.purpose) ?? key,
            screens: [],
            image: `screens/${key}.png`,
            elementCount: Array.isArray(json.elements) ? json.elements.length : 0,
        });
    }

    const screens: ScreensStore = { version: 1, shots: {} };
    for (const [key, json] of elementsByKey) {
        const size = Array.isArray(json.gameSize) && json.gameSize.length === 2
            ? [Number(json.gameSize[0]), Number(json.gameSize[1])] as [number, number]
            : null;
        const elements = Array.isArray(json.elements) ? json.elements.filter(isRecord).map(compactElement) : [];
        screens.shots[key] = { gameSize: size, elements };
    }

    const pack: PackStore = {
        version: 1,
        importedAt: now,
        sourcePath: raw.sourcePath,
        schemaVersion,
        scanner: { name: str(scanner.name) ?? "ren2leaf", version: str(scanner.version) ?? "0.0.0" },
        game: {
            name: str(game.name) ?? "",
            width: num(resolution.width),
            height: num(resolution.height),
        },
        sections,
        shots,
        speakers: raw.speakers ?? null,
        chapters: raw.chapters ?? null,
    };

    return {
        pack,
        inventory: { version: 1, inventory },
        screens,
        decisions: packDecisions(raw.speakers, raw.chapters, now),
    };
}

/**
 * One element as an agent needs it: where it is at 1920×1080, what it shows, where it is defined.
 * Drops the capture's bookkeeping (depth, walk order, the unscaled rect).
 */
export function compactElement(element: Record<string, unknown>): ScreenElement {
    const out: ScreenElement = { type: element.type };
    if (element.class && element.class !== element.type) out.class = element.class;
    out.rect = element.rect1920 ?? element.rect;
    for (const key of ["text", "image", "screen", "id", "style"] as const) {
        const value = element[key];
        if (value !== null && value !== undefined && value !== "") out[key] = value;
    }
    if (!element.image && element.info) out.info = element.info;
    if (Array.isArray(element.location) && element.location.length === 2) {
        out.location = `${element.location[0]}:${element.location[1]}`;
    }
    if (element.inButton) out.inButton = true;
    if (element.transformed) out.transformed = true;
    return out;
}

function describeSpeaker(entry: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(entry)) {
        if (key === "updatedAt" || value === null || value === undefined || value === "") continue;
        parts.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
    return parts.join("; ");
}

/** The migrator's settled decisions, so the agent and the author see them beside the open ones. */
export function packDecisions(speakers: unknown, chapters: unknown, now: string): Decision[] {
    const decisions: Decision[] = [];
    const table = isRecord(speakers) && isRecord(speakers.speakers) ? speakers.speakers : {};
    for (const [variable, entry] of Object.entries(table)) {
        if (!isRecord(entry)) continue;
        decisions.push({
            id: `pack:speaker:${variable}`,
            origin: "pack",
            question: `Who is the speaker \`${variable}\`?`,
            source: [],
            options: [],
            status: "answered",
            answer: { text: describeSpeaker(entry), at: str(entry.updatedAt) ?? now },
            seenByAgent: true,
            askedAt: str(entry.updatedAt) ?? now,
        });
    }
    if (isRecord(chapters) && Array.isArray(chapters.chapters)) {
        const lines = chapters.chapters.filter(isRecord).map(chapter => {
            const files = Array.isArray(chapter.files) ? chapter.files.join(", ") : "";
            return `${str(chapter.title) ?? str(chapter.id) ?? "?"}: ${files}`;
        });
        const excluded = Array.isArray(chapters.excluded) && chapters.excluded.length
            ? ` Excluded: ${chapters.excluded.join(", ")}.`
            : "";
        decisions.push({
            id: "pack:chapters",
            origin: "pack",
            question: "How is the script split into chapters?",
            source: [],
            options: [],
            status: "answered",
            answer: { text: `Split mode: ${str(chapters.mode) ?? "?"}. ${lines.join(" | ")}.${excluded}`, at: str(chapters.updatedAt) ?? now },
            seenByAgent: true,
            askedAt: str(chapters.updatedAt) ?? now,
        });
    }
    return decisions;
}
