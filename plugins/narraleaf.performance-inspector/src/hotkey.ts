/**
 * The chord grammar shared by the panel that shows the hotkey and the game that listens for it.
 *
 * Deliberately tiny: `Ctrl`, `Shift`, `Alt` and `Meta` in any order, then one key, joined by `+`.
 * The key half is matched against `KeyboardEvent.key` case-insensitively, which is what makes `F3`
 * and `p` both work without a second table mapping codes to names.
 *
 * A chord that fails to parse is not an error anyone can act on at runtime, so
 * {@link parseChord} answers `null` and the caller falls back to the default. The panel is where a
 * typo gets reported, because that is where someone can fix it.
 */

export type Chord = {
    key: string;
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    meta: boolean;
};

export type ChordEvent = {
    key: string;
    ctrlKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
    metaKey: boolean;
};

const MODIFIER_ALIASES: Record<string, keyof Omit<Chord, "key">> = {
    ctrl: "ctrl",
    control: "ctrl",
    ctl: "ctrl",
    shift: "shift",
    alt: "alt",
    option: "alt",
    opt: "alt",
    meta: "meta",
    cmd: "meta",
    command: "meta",
    super: "meta",
    win: "meta",
};

/** Spellings an author is likely to type for keys whose `KeyboardEvent.key` is a word. */
const KEY_ALIASES: Record<string, string> = {
    esc: "Escape",
    escape: "Escape",
    space: " ",
    spacebar: " ",
    enter: "Enter",
    return: "Enter",
    tab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    del: "Delete",
    insert: "Insert",
    ins: "Insert",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
};

function canonicalKey(token: string): string {
    const lower = token.toLowerCase();
    const alias = KEY_ALIASES[lower];
    if (alias) {
        return alias;
    }
    // Function keys are written the way the keyboard prints them.
    if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) {
        return lower.toUpperCase();
    }
    return token;
}

export function parseChord(text: string): Chord | null {
    if (typeof text !== "string") {
        return null;
    }
    const tokens = text.split("+").map(part => part.trim()).filter(part => part.length > 0);
    if (tokens.length === 0) {
        return null;
    }
    const chord: Chord = { key: "", ctrl: false, shift: false, alt: false, meta: false };
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const modifier = MODIFIER_ALIASES[token.toLowerCase()];
        if (modifier) {
            chord[modifier] = true;
            continue;
        }
        if (chord.key) {
            // Two non-modifier tokens: the author wrote something this grammar cannot express.
            return null;
        }
        chord.key = canonicalKey(token);
    }
    return chord.key ? chord : null;
}

/** The chord written back out, so the panel echoes a canonical spelling rather than the raw text. */
export function formatChord(chord: Chord): string {
    const parts: string[] = [];
    if (chord.ctrl) {
        parts.push("Ctrl");
    }
    if (chord.alt) {
        parts.push("Alt");
    }
    if (chord.shift) {
        parts.push("Shift");
    }
    if (chord.meta) {
        parts.push("Meta");
    }
    parts.push(chord.key === " " ? "Space" : chord.key);
    return parts.join("+");
}

/**
 * Whether an event is this chord.
 *
 * `shiftOverride` exists because the profiler binds two things to one configured chord: the chord
 * opens the HUD and the chord with Shift opens the full inspector. Passing `true` asks "is this the
 * chord, but shifted", which is only meaningful when the chord did not already ask for Shift - a
 * chord the author wrote with Shift in it has no shifted variant, and the caller is told so by
 * {@link chordHasShiftVariant}.
 */
export function matchesChord(chord: Chord, event: ChordEvent, shiftOverride = false): boolean {
    if (typeof event.key !== "string") {
        return false;
    }
    if (event.key.toLowerCase() !== chord.key.toLowerCase()) {
        return false;
    }
    return (
        event.ctrlKey === chord.ctrl &&
        event.altKey === chord.alt &&
        event.metaKey === chord.meta &&
        event.shiftKey === (shiftOverride ? true : chord.shift)
    );
}

export function chordHasShiftVariant(chord: Chord): boolean {
    return !chord.shift;
}
