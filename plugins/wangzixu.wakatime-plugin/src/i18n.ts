/**
 * The plugin's own message tables, handed to `app.services.i18n.createTranslator`.
 *
 * Unrelated to Studio's translations and to a game's player-facing localization:
 * this catalog only covers strings this dialog draws. Studio's built-in locale
 * codes are `en` and `zh`; the extra aliases exist so a plugin-provided Chinese
 * locale (a language pack keyed `zh-CN`, or the catgirl one) still lands on the
 * Chinese table instead of falling all the way back to English.
 */

import type { PluginMessageBundle } from "narraleaf-studio/plugin";

const en: Record<string, string> = {
    "action.open": "WakaTime",
    "dialog.title": "WakaTime",

    "field.enabled": "Track my authoring time with WakaTime",
    "field.enabledHint": "Nothing is reported while this is off, or while either field below is not filled in correctly",
    "field.apiKey": "API key",
    // `{url}` is substituted with the click-to-copy address, not with a string —
    // `t()` leaves the token in place and `ApiKeyHint` splits the sentence on it.
    "field.apiKeyHint": "Get one at {url}. Stored on this device only — set it up again on another device",
    "field.apiKeyPlaceholder": "waka_…",
    "field.copyLink": "Click to copy — Studio does not let a plugin open a browser",
    "field.copied": "Copied — paste it in your browser",
    "field.copyFailed": "Could not copy. Select the address and copy it by hand.",
    "field.reveal": "Show the API key",
    "field.hide": "Hide the API key",
    "field.project": "Project name",
    "field.projectHint": "Saved inside the project, so collaborators report to the same WakaTime project",
    "field.projectPlaceholder": "My NarraLeaf Project",

    "status.tracking": "Tracking · {total} today",
    "status.trackingUnknown": "Tracking",
    "status.disabled": "Off",
    "status.needsKey": "Waiting for an API key",
    "status.needsProject": "Waiting for a project name",
    "status.pausedForAuth": "Stopped — the server rejected the key",
    "status.queued": "{count} heartbeat(s) waiting to send",
    "status.frozen": "The project is read-only right now, so the project name cannot be changed.",

    "action.test": "Test",
    "action.testing": "Testing…",
    "action.close": "Close",
    "test.ok": "Connected. {total} today.",
    "test.failed": "Could not connect: {message}",
    "test.auth": "The server rejected that API key.",
    "notify.auth": "WakaTime stopped: the server rejected the API key. Open the WakaTime dialog to fix it.",
};

const zh: Record<string, string> = {
    "action.open": "WakaTime",
    "dialog.title": "WakaTime",

    "field.enabled": "使用WakaTime记录创作时间",
    "field.enabledHint": "关闭或下面两项未正确填写时，将不会上报任何数据",
    "field.apiKey": "API Key",
    "field.apiKeyHint": "在 {url} 获取，仅存储在本设备上，切换设备时请重新配置",
    "field.apiKeyPlaceholder": "waka_…",
    "field.copyLink": "点击复制 —— Studio 不允许插件打开浏览器",
    "field.copied": "已复制，去浏览器里粘贴",
    "field.copyFailed": "复制失败，请手动选中地址复制。",
    "field.reveal": "显示 API Key",
    "field.hide": "隐藏 API Key",
    "field.project": "项目名",
    "field.projectHint": "将会保存在项目内，因此协作者会被上报到同一个WakaTime项目",
    "field.projectPlaceholder": "My NarraLeaf Project",

    "status.tracking": "正在记录 · 今日 {total}",
    "status.trackingUnknown": "正在记录",
    "status.disabled": "已关闭",
    "status.needsKey": "等待填写 API Key",
    "status.needsProject": "等待填写项目名",
    "status.pausedForAuth": "已停止 —— 服务器拒绝了这个 Key",
    "status.queued": "{count} 条心跳待发送",
    "status.frozen": "项目当前是只读状态，项目名改不了。",

    "action.test": "测试",
    "action.testing": "测试中…",
    "action.close": "关闭",
    "test.ok": "连接成功，今日 {total}。",
    "test.failed": "连接失败：{message}",
    "test.auth": "服务器拒绝了这个 API Key。",
    "notify.auth": "WakaTime 已停止：服务器拒绝了这个 API Key。打开 WakaTime 对话框修改。",
};

export const MESSAGES: PluginMessageBundle = {
    messages: {
        en,
        zh,
        "zh-CN": zh,
        "zh-x-neko": zh,
    },
    fallbackLocale: "en",
};
