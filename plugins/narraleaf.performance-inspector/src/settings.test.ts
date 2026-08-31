import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_VERSION, normalizeSettings } from "./settings";

describe("normalizeSettings", () => {
    it("answers the defaults for a project that never opened the panel", () => {
        expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
        expect(normalizeSettings("not a record")).toEqual(DEFAULT_SETTINGS);
    });

    it("defaults availability to Dev Mode, so a build cannot ship the overlay by omission", () => {
        expect(normalizeSettings({}).availability).toBe("studio");
        expect(normalizeSettings({ availability: "everything" }).availability).toBe("studio");
        expect(normalizeSettings({ availability: "everywhere" }).availability).toBe("everywhere");
    });

    it("keeps a whole object when one field is nonsense", () => {
        const settings = normalizeSettings({
            availability: "everywhere",
            hotkey: 42,
            openAt: "somewhere",
            corner: "middle",
            historySeconds: "long",
            instrumentAssets: "yes",
            logOnCapture: null,
        });
        expect(settings).toEqual({
            ...DEFAULT_SETTINGS,
            availability: "everywhere",
        });
    });

    it("snaps a history length onto the nearest offered one", () => {
        expect(normalizeSettings({ historySeconds: 45 }).historySeconds).toBe(30);
        expect(normalizeSettings({ historySeconds: 61 }).historySeconds).toBe(60);
        expect(normalizeSettings({ historySeconds: 100000 }).historySeconds).toBe(300);
    });

    it("trims the hotkey and refuses to store an empty one", () => {
        expect(normalizeSettings({ hotkey: "  Ctrl+P  " }).hotkey).toBe("Ctrl+P");
        expect(normalizeSettings({ hotkey: "   " }).hotkey).toBe(DEFAULT_SETTINGS.hotkey);
    });

    it("stamps the current version whatever the stored record claimed", () => {
        expect(normalizeSettings({ version: 99 }).version).toBe(SETTINGS_VERSION);
    });
});
