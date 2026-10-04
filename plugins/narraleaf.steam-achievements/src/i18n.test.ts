import { describe, expect, it } from "vitest";
import { emptyCatalog, validateCatalog } from "./catalog";
import { MESSAGES, translateEnglish, type MessageKey } from "./i18n";

const en = MESSAGES.messages.en;
const zh = MESSAGES.messages.zh;

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("message tables", () => {
    it("fill the same placeholders in both languages", () => {
        for (const key of Object.keys(en)) {
            expect(placeholders(zh[key]), key).toEqual(placeholders(en[key]));
        }
    });

    it("end no Chinese string with a full stop", () => {
        expect(Object.entries(zh).filter(([, text]) => /[。.]$/.test(text))).toEqual([]);
    });

    it("route every Chinese alias to the Chinese table", () => {
        expect(MESSAGES.messages["zh-CN"]).toBe(zh);
        expect(MESSAGES.messages["zh-x-neko"]).toBe(zh);
    });
});

describe("translateEnglish", () => {
    it("fills placeholders and leaves unknown ones in place", () => {
        expect(translateEnglish("toolbar.errors", { count: 2 })).toBe("2 errors");
        expect(translateEnglish("toolbar.errors")).toBe("{count} errors");
    });
});

describe("validateCatalog in Chinese", () => {
    it("words its messages with the translator it is given", () => {
        const t = (key: MessageKey, params?: Record<string, string | number>) =>
            zh[key].replace(/\{(\w+)\}/g, (token, name: string) =>
                params && name in params ? String(params[name]) : token);
        const issues = validateCatalog({
            ...emptyCatalog(),
            achievements: [{ id: "has space" }],
        }, t);
        expect(issues.map(issue => issue.message)).toEqual([
            "API 名称“has space”只能包含 A-Z、a-z、0-9 和下划线，长度为 1-44 个字符",
            "未设置 Steam App ID",
        ]);
    });
});
