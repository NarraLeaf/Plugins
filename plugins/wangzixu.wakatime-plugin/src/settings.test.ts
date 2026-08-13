import { describe, expect, it } from "vitest";
import {
    DEFAULT_PROJECT_SETTINGS,
    normalizeMachineSettings,
    normalizeProjectSettings,
    toCredentials,
} from "./settings";

describe("normalizeMachineSettings", () => {
    it("survives an absent or corrupt store", () => {
        for (const raw of [null, undefined, 42, "nope", []]) {
            expect(normalizeMachineSettings(raw)).toEqual({ apiKey: "", enabled: true });
        }
    });

    it("trims a pasted key, which usually arrives with a newline", () => {
        expect(normalizeMachineSettings({ apiKey: " waka_abc\n" }).apiKey).toBe("waka_abc");
    });

    it("keeps an explicit opt-out", () => {
        expect(normalizeMachineSettings({ enabled: false }).enabled).toBe(false);
    });
});

describe("toCredentials", () => {
    it("cleans at the point of use, so an edit in progress is never rewritten", () => {
        expect(toCredentials(" waka_abc ", "0.1.0")).toEqual({
            apiKey: "waka_abc",
            userAgent: "narraleaf-studio/unknown narraleaf-wakatime/0.1.0",
        });
    });
});

describe("normalizeProjectSettings", () => {
    it("defaults an unvisited project to unnamed, which is what makes it inert", () => {
        expect(normalizeProjectSettings(null)).toEqual(DEFAULT_PROJECT_SETTINGS);
        expect(normalizeProjectSettings(null).projectName).toBe("");
    });

    it("keeps the author's text exactly, so a debounced commit cannot edit it back", () => {
        // Trimming here would eat the space half a second after it was typed.
        expect(normalizeProjectSettings({ projectName: "My Novel " }).projectName).toBe("My Novel ");
    });

    it("ignores a corrupt value rather than propagating it", () => {
        expect(normalizeProjectSettings({ projectName: 42 }).projectName).toBe("");
    });
});
