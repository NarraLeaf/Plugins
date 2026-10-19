/**
 * The settings panel's words, in the editor's language.
 *
 * Handed to `app.services.i18n.createTranslator`, so they follow the language Studio is in. The
 * overlay is a different audience and has its own table in ./strings.ts: it draws inside the game
 * and follows the language the player chose.
 *
 * The Chinese and Japanese tables are typed against the English keys, so a key added to one table
 * and not the others fails to compile. Studio's built-in locales are `zh` and `ja`; the two other
 * Chinese codes are plugin-provided locales (a language pack keyed `zh-CN`, the catgirl one), which
 * land on the Chinese table rather than falling all the way back to English.
 *
 * Node names stay in English in every table, because the nodes are registered under their English
 * names and that is what the palette shows.
 */

import type { PluginMessageBundle } from "narraleaf-studio/plugin";

const en = {
    "rail.title": "Performance",
    "header.title": "Performance Inspector",
    "header.description": "Frame rate, memory and asset loading, measured inside the running game.",

    "section.availability": "Availability",
    "availability.label": "Overlay availability",
    "availability.studio.description": "Only Dev Mode. In a preview or a built game the nodes do nothing.",
    "availability.everywhere.description": "Previews and built games can open the overlay. Whatever opens it in Dev Mode opens it for a player too.",
    "availability.option.studio": "Dev Mode only",
    "availability.option.everywhere": "Dev Mode and every build",
    "collectFrom.label": "Start measuring",
    "collectFrom.gameStart.description": "From the first frame, so startup is covered.",
    "collectFrom.graph.description": "Nothing is measured until a Start Profiling node runs, so the boot is not covered.",
    "collectFrom.option.gameStart": "At game start",
    "collectFrom.option.graph": "When a graph says so",
    "openAt.label": "Overlay at game start",
    "openAt.option.hidden": "Nothing",
    "openAt.option.hud": "Compact display",
    "openAt.option.inspector": "Full panel",
    "corner.label": "Compact display corner",
    "corner.option.topLeft": "Top left",
    "corner.option.topRight": "Top right",
    "corner.option.bottomLeft": "Bottom left",
    "corner.option.bottomRight": "Bottom right",

    "section.collection": "Collection",
    "instrumentAssets.label": "Measure asset loading",
    "instrumentAssets.description": "Asset sizes, request counts, decode time, and what is still held in memory.",
    "historySeconds.label": "Frame history",
    "historySeconds.description": "How far back the frame-time chart and the percentiles reach.",
    "historySeconds.minutes": "{count} min",
    "historySeconds.seconds": "{count} s",
    "logOnCapture.label": "Reports in the game log",
    "logOnCapture.description": "A capture also lands in the log file the build writes, so it survives the run.",

    "section.inGame": "In the game",
    "opening.label": "Opening the overlay",
    "opening.description": "A Set Performance Overlay node. For a key, put an On Key Down head in the game's global blueprint and wire it to that node — the binding is yours, and this plugin takes no key of its own.",
    "nodes.label": "Blueprint nodes",
    "nodes.description": "Start and Stop Profiling, Set Performance Overlay, Mark Performance Event, Begin and End Performance Span, Get Performance Stats, and Capture Performance Report, under the Performance category.",
    "reports.label": "Reports",
    "reports.description": "The full panel copies a report as JSON or as a written summary, and keeps the last capture in plugin storage.",
};

export type EditorMessageKey = keyof typeof en;
export type EditorTranslate = (key: EditorMessageKey, params?: Record<string, string | number>) => string;

const zh: Record<EditorMessageKey, string> = {
    "rail.title": "性能",
    "header.title": "性能检查器",
    "header.description": "在运行中的游戏内测量帧率、内存与资产加载",

    "section.availability": "可用范围",
    "availability.label": "浮层可用范围",
    "availability.studio.description": "仅在开发模式中可用；在预览与构建出的游戏中，这些节点不执行任何操作",
    "availability.everywhere.description": "预览与构建出的游戏均可打开浮层；在开发模式中打开浮层的操作，对玩家同样有效",
    "availability.option.studio": "仅开发模式",
    "availability.option.everywhere": "开发模式与所有构建",
    "collectFrom.label": "开始测量",
    "collectFrom.gameStart.description": "从第一帧开始测量，包含启动过程",
    "collectFrom.graph.description": "Start Profiling 节点执行之前不进行测量，因此不包含启动过程",
    "collectFrom.option.gameStart": "游戏启动时",
    "collectFrom.option.graph": "由蓝图启动",
    "openAt.label": "游戏启动时的浮层",
    "openAt.option.hidden": "不显示",
    "openAt.option.hud": "精简显示",
    "openAt.option.inspector": "完整面板",
    "corner.label": "精简显示的位置",
    "corner.option.topLeft": "左上角",
    "corner.option.topRight": "右上角",
    "corner.option.bottomLeft": "左下角",
    "corner.option.bottomRight": "右下角",

    "section.collection": "采集",
    "instrumentAssets.label": "测量资产加载",
    "instrumentAssets.description": "资产大小、请求次数、解码耗时，以及仍驻留在内存中的内容",
    "historySeconds.label": "帧历史",
    "historySeconds.description": "帧耗时图表与百分位数所覆盖的时长",
    "historySeconds.minutes": "{count} 分钟",
    "historySeconds.seconds": "{count} 秒",
    "logOnCapture.label": "报告写入游戏日志",
    "logOnCapture.description": "捕获的报告同时写入构建生成的日志文件，运行结束后仍然保留",

    "section.inGame": "游戏内",
    "opening.label": "浮层的打开方式",
    "opening.description": "使用 Set Performance Overlay 节点。如需按键打开，在游戏的全局蓝图中添加「按键按下时」事件头节点并连接到该节点；按键由作者绑定，本插件不占用任何按键",
    "nodes.label": "蓝图节点",
    "nodes.description": "Performance 分类下的 Start Profiling、Stop Profiling、Set Performance Overlay、Mark Performance Event、Begin Performance Span、End Performance Span、Get Performance Stats 与 Capture Performance Report",
    "reports.label": "报告",
    "reports.description": "完整面板可将报告复制为 JSON 或文字摘要，并在插件存储中保留最近一次捕获",
};

const ja: Record<EditorMessageKey, string> = {
    "rail.title": "パフォーマンス",
    "header.title": "パフォーマンス インスペクター",
    "header.description": "実行中のゲーム内でフレームレート、メモリ、アセットの読み込みを計測する",

    "section.availability": "利用範囲",
    "availability.label": "オーバーレイ",
    "availability.studio.description": "開発モードのみ。プレビューとビルドしたゲームでは、これらのノードは何もしない",
    "availability.everywhere.description": "プレビューとビルドしたゲームでもオーバーレイを開ける。開発モードでオーバーレイを開く操作は、プレイヤーに対しても同じように働く",
    "availability.option.studio": "開発モードのみ",
    "availability.option.everywhere": "開発モードと全ビルド",
    "collectFrom.label": "計測の開始",
    "collectFrom.gameStart.description": "最初のフレームから計測し、起動処理も含まれる",
    "collectFrom.graph.description": "Start Profiling ノードが実行されるまで計測しないため、起動処理は含まれない",
    "collectFrom.option.gameStart": "ゲーム開始時",
    "collectFrom.option.graph": "ブループリントから開始",
    "openAt.label": "開始時の表示",
    "openAt.option.hidden": "表示しない",
    "openAt.option.hud": "簡易表示",
    "openAt.option.inspector": "詳細パネル",
    "corner.label": "簡易表示の位置",
    "corner.option.topLeft": "左上",
    "corner.option.topRight": "右上",
    "corner.option.bottomLeft": "左下",
    "corner.option.bottomRight": "右下",

    "section.collection": "収集",
    "instrumentAssets.label": "アセット読み込みの計測",
    "instrumentAssets.description": "アセットのサイズ、要求回数、デコード時間、メモリに保持されたままの内容",
    "historySeconds.label": "フレーム履歴",
    "historySeconds.description": "フレーム時間のグラフとパーセンタイルが対象とする期間",
    "historySeconds.minutes": "{count} 分",
    "historySeconds.seconds": "{count} 秒",
    "logOnCapture.label": "ゲームログへのレポート出力",
    "logOnCapture.description": "キャプチャしたレポートはビルドが書き出すログファイルにも記録され、実行の終了後も残る",

    "section.inGame": "ゲーム内",
    "opening.label": "オーバーレイの開き方",
    "opening.description": "Set Performance Overlay ノードを使う。キーで開くには、ゲームのグローバルブループリントに「キーを押したとき」の先頭ノードを置き、このノードにつなぐ。キーの割り当ては作者が行い、このプラグイン自身はキーを占有しない",
    "nodes.label": "ブループリントノード",
    "nodes.description": "Performance カテゴリの Start Profiling、Stop Profiling、Set Performance Overlay、Mark Performance Event、Begin Performance Span、End Performance Span、Get Performance Stats、Capture Performance Report",
    "reports.label": "レポート",
    "reports.description": "詳細パネルからレポートを JSON または文章の要約としてコピーでき、最後のキャプチャはプラグインのストレージに保存される",
};

export const EDITOR_MESSAGES: PluginMessageBundle = {
    messages: {
        en,
        zh,
        ja,
        "zh-CN": zh,
        "zh-x-neko": zh,
    },
    fallbackLocale: "en",
};
