import { describe, expect, it } from "vitest";
import { chordHasShiftVariant, formatChord, matchesChord, parseChord } from "./hotkey";

function keyEvent(key: string, modifiers: Partial<Record<"ctrl" | "shift" | "alt" | "meta", boolean>> = {}) {
    return {
        key,
        ctrlKey: modifiers.ctrl ?? false,
        shiftKey: modifiers.shift ?? false,
        altKey: modifiers.alt ?? false,
        metaKey: modifiers.meta ?? false,
    };
}

describe("parseChord", () => {
    it("reads a bare function key", () => {
        expect(parseChord("F3")).toEqual({ key: "F3", ctrl: false, shift: false, alt: false, meta: false });
    });

    it("accepts modifiers in any order and any casing", () => {
        expect(parseChord("shift+CTRL+p")).toEqual({ key: "p", ctrl: true, shift: true, alt: false, meta: false });
    });

    it("takes the spellings an author is likely to type", () => {
        expect(parseChord("cmd+esc")?.meta).toBe(true);
        expect(parseChord("cmd+esc")?.key).toBe("Escape");
        expect(parseChord("f9")?.key).toBe("F9");
        expect(parseChord("Ctrl+Space")?.key).toBe(" ");
    });

    it("refuses two keys, and anything empty", () => {
        expect(parseChord("F3+F4")).toBeNull();
        expect(parseChord("")).toBeNull();
        expect(parseChord("Ctrl+")).toBeNull();
    });
});

describe("formatChord", () => {
    it("writes modifiers in a fixed order so the field echoes one spelling", () => {
        const chord = parseChord("shift+alt+ctrl+k");
        expect(chord).not.toBeNull();
        expect(formatChord(chord!)).toBe("Ctrl+Alt+Shift+k");
    });

    it("names the space bar rather than printing one", () => {
        expect(formatChord(parseChord("space")!)).toBe("Space");
    });
});

describe("matchesChord", () => {
    const chord = parseChord("F3")!;

    it("matches the chord exactly, modifiers included", () => {
        expect(matchesChord(chord, keyEvent("F3"))).toBe(true);
        expect(matchesChord(chord, keyEvent("F3", { ctrl: true }))).toBe(false);
        expect(matchesChord(chord, keyEvent("F4"))).toBe(false);
    });

    it("compares the key case-insensitively so a shifted letter still matches", () => {
        const letter = parseChord("Ctrl+p")!;
        expect(matchesChord(letter, keyEvent("P", { ctrl: true }))).toBe(true);
    });

    it("recognises the shifted variant only when asked for it", () => {
        expect(matchesChord(chord, keyEvent("F3", { shift: true }))).toBe(false);
        expect(matchesChord(chord, keyEvent("F3", { shift: true }), true)).toBe(true);
        expect(matchesChord(chord, keyEvent("F3"), true)).toBe(false);
    });
});

describe("chordHasShiftVariant", () => {
    it("is false for a chord that already asked for Shift", () => {
        expect(chordHasShiftVariant(parseChord("F3")!)).toBe(true);
        expect(chordHasShiftVariant(parseChord("Shift+F3")!)).toBe(false);
    });
});
