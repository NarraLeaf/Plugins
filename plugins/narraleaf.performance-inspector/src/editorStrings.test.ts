import { describe, expect, it } from "vitest";
import { EDITOR_MESSAGES } from "./editorStrings";
import { createPerformanceNodes, inertBridge } from "./nodes";

const { en, zh, ja } = EDITOR_MESSAGES.messages;
const translated = { zh, ja };

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("settings panel message tables", () => {
    it("word every English key in Chinese and Japanese", () => {
        for (const [locale, table] of Object.entries(translated)) {
            expect(Object.keys(table).sort(), locale).toEqual(Object.keys(en).sort());
            expect(Object.entries(table).filter(([, text]) => !text.trim()), locale).toEqual([]);
        }
    });

    it("fill the same placeholders in every language", () => {
        for (const [locale, table] of Object.entries(translated)) {
            for (const key of Object.keys(en)) {
                expect(placeholders(table[key]), `${locale} ${key}`).toEqual(placeholders(en[key]));
            }
        }
    });

    it("end no Chinese or Japanese string with a full stop, as Studio's own catalogue does not", () => {
        for (const [locale, table] of Object.entries(translated)) {
            expect(Object.entries(table).filter(([, text]) => /[。．.]$/.test(text)), locale).toEqual([]);
        }
    });

    it("write Japanese in the plain form Studio's catalogue uses", () => {
        expect(Object.entries(ja).filter(([, text]) => /(です|ます)(。|$)/.test(text))).toEqual([]);
    });

    it("name every node the plugin registers, under the name the palette shows", () => {
        // The nodes are registered in English, so the row that lists them keeps their English names
        // in every language; a renamed node has to be renamed here too.
        for (const node of createPerformanceNodes(inertBridge)) {
            const name = String(node.displayName);
            for (const [locale, table] of Object.entries(translated)) {
                expect(table["nodes.description"], `${locale} ${name}`).toContain(name);
            }
        }
    });

    it("route the plugin-provided Chinese locales to the Chinese table", () => {
        expect(EDITOR_MESSAGES.messages["zh-CN"]).toBe(zh);
        expect(EDITOR_MESSAGES.messages["zh-x-neko"]).toBe(zh);
        expect(EDITOR_MESSAGES.fallbackLocale).toBe("en");
    });
});
