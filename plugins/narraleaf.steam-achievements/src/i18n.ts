/**
 * The plugin's own message tables, handed to `app.services.i18n.createTranslator`.
 *
 * Unrelated to Studio's own translations and to anything a player reads: this only
 * covers the words the plugin itself draws in the editor — the achievements tab,
 * the catalog checks and the blueprint node labels.
 *
 * Studio's built-in Chinese locale is `zh`; the aliases exist so a plugin-provided
 * Chinese locale (a language pack keyed `zh-CN`, or the catgirl one) still lands on
 * the Chinese table instead of falling all the way back to English.
 */

import type { PluginMessageBundle } from "narraleaf-studio/plugin";

const en = {
    "tab.title": "Achievements",

    "toolbar.appId": "Steam App ID",
    "toolbar.searchPlaceholder": "Search achievements",
    "toolbar.errors": "{count} errors",
    "toolbar.warnings": "{count} warnings",

    "notice.steamworks": "Names, descriptions and icons are set in Steamworks. List each achievement here by its API Name in Steamworks.",
    "notice.sync": "Achievements and stats are saved on the player's device. While Steam is running, preview and desktop builds also send them to Steam, including achievements earned while Steam was closed. Dev Mode, web and mobile builds do not connect to Steam.",

    "achievements.title": "Achievements",
    "achievements.add": "Achievement",
    "achievements.apiName": "API Name",
    "achievements.empty": "No achievements",
    "achievements.noMatches": "No matches",
    "achievements.delete": "Delete achievement",

    "stats.title": "Stats",
    "stats.add": "Stat",
    "stats.apiName": "API Name",
    "stats.type": "Type",
    "stats.default": "Default",
    "stats.min": "Min",
    "stats.max": "Max",
    "stats.incrementOnly": "Increment only",
    "stats.empty": "No stats",
    "stats.delete": "Delete stat",

    "issue.statApiName": "Stat API Name \"{id}\" must match A-Z a-z 0-9 _ (1-44 characters)",
    "issue.statDuplicate": "Duplicate stat \"{id}\"",
    "issue.statRange": "Stat \"{id}\" has min above max",
    "issue.apiName": "API Name \"{id}\" must match A-Z a-z 0-9 _ (1-44 characters)",
    "issue.duplicate": "Duplicate API Name \"{id}\"",
    "issue.noAppId": "No Steam App ID set",

    "node.unlock": "Unlock Achievement",
    "node.isUnlocked": "Is Achievement Unlocked",
    "node.indicateProgress": "Indicate Achievement Progress",
    "node.setStat": "Set Stat",
    "node.addStat": "Add Stat",
    "node.getStat": "Get Stat",
    "node.available": "Steam Available",
    "node.language": "Steam Language",
    "node.openStorePage": "Open Store Page",
    "node.ownsDlc": "Owns DLC",
    "node.resetAll": "Reset All Stats",

    "pin.in": "In",
    "pin.next": "Next",
    "pin.achievementId": "Achievement Id",
    "pin.statId": "Stat Id",
    "pin.unlocked": "Unlocked",
    "pin.current": "Current",
    "pin.max": "Max",
    "pin.value": "Value",
    "pin.delta": "Delta",
    "pin.available": "Available",
    "pin.appId": "App Id",
    "pin.language": "Language",
    "pin.failed": "Failed",
    "pin.error": "Error",
    "pin.owned": "Owned",
    "pin.notOwned": "Not Owned",
    "pin.isOwned": "Is Owned",
    "pin.alsoAchievements": "Also Achievements",

    "param.achievement": "Achievement",
    "param.stat": "Stat",
    "param.appId": "App ID",
    "param.dlcAppId": "DLC App ID",
};

export type MessageKey = keyof typeof en;
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

// Typed against the English keys, so a key added to one table and not the other is a
// compile error rather than an English string surfacing in the Chinese UI.
const zh: Record<MessageKey, string> = {
    "tab.title": "成就",

    "toolbar.appId": "Steam App ID",
    "toolbar.searchPlaceholder": "搜索成就",
    "toolbar.errors": "{count} 个错误",
    "toolbar.warnings": "{count} 个警告",

    "notice.steamworks": "成就的名称、描述和图标在 Steamworks 中设置。此处按 Steamworks 中的 API 名称列出每个成就",
    "notice.sync": "成就与统计数据保存在玩家设备上。Steam 运行时，预览和桌面版游戏会同时写入 Steam，Steam 关闭期间获得的成就也会补写。开发模式、网页版和移动版不连接 Steam",

    "achievements.title": "成就",
    "achievements.add": "添加成就",
    "achievements.apiName": "API 名称",
    "achievements.empty": "暂无成就",
    "achievements.noMatches": "无匹配结果",
    "achievements.delete": "删除成就",

    "stats.title": "统计数据",
    "stats.add": "添加统计数据",
    "stats.apiName": "API 名称",
    "stats.type": "类型",
    "stats.default": "默认值",
    "stats.min": "最小值",
    "stats.max": "最大值",
    "stats.incrementOnly": "仅递增",
    "stats.empty": "暂无统计数据",
    "stats.delete": "删除统计数据",

    "issue.statApiName": "统计数据 API 名称“{id}”只能包含 A-Z、a-z、0-9 和下划线，长度为 1-44 个字符",
    "issue.statDuplicate": "统计数据 API 名称“{id}”重复",
    "issue.statRange": "统计数据“{id}”的最小值大于最大值",
    "issue.apiName": "API 名称“{id}”只能包含 A-Z、a-z、0-9 和下划线，长度为 1-44 个字符",
    "issue.duplicate": "API 名称“{id}”重复",
    "issue.noAppId": "未设置 Steam App ID",

    "node.unlock": "解锁成就",
    "node.isUnlocked": "成就是否已解锁",
    "node.indicateProgress": "显示成就进度",
    "node.setStat": "设置统计数据",
    "node.addStat": "累加统计数据",
    "node.getStat": "获取统计数据",
    "node.available": "Steam 是否可用",
    "node.language": "Steam 语言",
    "node.openStorePage": "打开商店页面",
    "node.ownsDlc": "是否拥有 DLC",
    "node.resetAll": "重置所有统计数据",

    "pin.in": "进入",
    "pin.next": "下一步",
    "pin.achievementId": "成就 ID",
    "pin.statId": "统计数据 ID",
    "pin.unlocked": "已解锁",
    "pin.current": "当前值",
    "pin.max": "最大值",
    "pin.value": "值",
    "pin.delta": "增量",
    "pin.available": "可用",
    "pin.appId": "App ID",
    "pin.language": "语言",
    "pin.failed": "失败",
    "pin.error": "错误",
    "pin.owned": "已拥有",
    "pin.notOwned": "未拥有",
    "pin.isOwned": "是否拥有",
    "pin.alsoAchievements": "同时重置成就",

    "param.achievement": "成就",
    "param.stat": "统计数据",
    "param.appId": "App ID",
    "param.dlcAppId": "DLC App ID",
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

/**
 * The English table without Studio's translator, for the code that has no editor
 * language to follow: the runtime entry registers the same node definitions, and
 * the catalog checks run in tests. Fills `{placeholder}` tokens the way `t()` does.
 */
export const translateEnglish: Translate = (key, params) =>
    en[key].replace(/\{(\w+)\}/g, (token, name: string) =>
        params && name in params ? String(params[name]) : token);
