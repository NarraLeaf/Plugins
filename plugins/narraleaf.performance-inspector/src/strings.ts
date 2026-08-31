/**
 * The overlay's own words, in the game's language.
 *
 * The overlay draws inside the game, so it follows the language the player chose rather than the
 * one Studio is in - an author testing a Japanese build should not get an English panel over it.
 * Studio's own translation service is not reachable from game code, so the table is here: three
 * languages, resolved by primary subtag, English for everything else.
 *
 * Deliberately not a general i18n layer. It is one flat record per language and a compile error the
 * moment a key is added to one and not the others.
 */

export type OverlayStrings = {
    title: string;
    hudFps: string;
    hudFrame: string;
    hudHeap: string;
    hudHeld: string;
    hudLoaded: string;
    tabOverview: string;
    tabFrames: string;
    tabAssets: string;
    tabMemory: string;
    tabTimeline: string;
    close: string;
    copyJson: string;
    copySummary: string;
    logReport: string;
    resetSession: string;
    copied: string;
    copyFailed: string;
    loggedToGameLog: string;
    sessionLength: string;
    framesAverage: string;
    framesRecent: string;
    framePercentiles: string;
    hitches: string;
    stalls: string;
    longTasks: string;
    blockingTime: string;
    notMeasured: string;
    heapUsed: string;
    heapPeak: string;
    heapLimit: string;
    heldInMemory: string;
    heldExplain: string;
    assetsSummary: string;
    repeatFetches: string;
    decodeTime: string;
    failedRequests: string;
    columnAsset: string;
    columnKind: string;
    columnRequests: string;
    columnBytes: string;
    columnDecode: string;
    columnHeld: string;
    sortBytes: string;
    sortRequests: string;
    sortDecode: string;
    sortRecent: string;
    filterPlaceholder: string;
    noAssets: string;
    instrumentationOff: string;
    noTimeline: string;
    playthrough: string;
    scenes: string;
    lines: string;
    choices: string;
    saves: string;
    overhead: string;
    notes: string;
    spans: string;
    openSpans: string;
    hotkeyHint: string;
};

const EN: OverlayStrings = {
    title: "Performance Inspector",
    hudFps: "fps",
    hudFrame: "frame",
    hudHeap: "heap",
    hudHeld: "held",
    hudLoaded: "loaded",
    tabOverview: "Overview",
    tabFrames: "Frames",
    tabAssets: "Assets",
    tabMemory: "Memory",
    tabTimeline: "Timeline",
    close: "Close",
    copyJson: "Copy JSON",
    copySummary: "Copy summary",
    logReport: "Write to game log",
    resetSession: "Reset session",
    copied: "Copied to the clipboard.",
    copyFailed: "Could not reach the clipboard. The report was written to the game log instead.",
    loggedToGameLog: "Report written to the game log.",
    sessionLength: "Session",
    framesAverage: "Average",
    framesRecent: "Now",
    framePercentiles: "Frame time",
    hitches: "Hitches over 33ms",
    stalls: "Stalls over 100ms",
    longTasks: "Long tasks",
    blockingTime: "Blocking time",
    notMeasured: "not measured on this engine",
    heapUsed: "JS heap in use",
    heapPeak: "Peak",
    heapLimit: "Limit",
    heldInMemory: "Held in memory",
    heldExplain: "Payloads the game is still holding through a live object URL, by kind.",
    assetsSummary: "Assets loaded",
    repeatFetches: "Re-fetched",
    decodeTime: "Image decoding",
    failedRequests: "Failed requests",
    columnAsset: "Asset",
    columnKind: "Kind",
    columnRequests: "Reqs",
    columnBytes: "Bytes",
    columnDecode: "Decode",
    columnHeld: "Held",
    sortBytes: "Bytes",
    sortRequests: "Requests",
    sortDecode: "Decode",
    sortRecent: "Recent",
    filterPlaceholder: "Filter assets",
    noAssets: "Nothing has been loaded yet.",
    instrumentationOff: "Asset instrumentation is off, so byte counts and retention are unavailable. Turn it on in Studio, under the Performance panel.",
    noTimeline: "Nothing has happened yet.",
    playthrough: "Playthrough",
    scenes: "Scenes",
    lines: "Lines",
    choices: "Choices",
    saves: "Saves",
    overhead: "Profiler overhead",
    notes: "Notes",
    spans: "Spans",
    openSpans: "Still open",
    hotkeyHint: "Press again to hide, with Shift for the full panel.",
};

const ZH: OverlayStrings = {
    title: "性能检查器",
    hudFps: "帧率",
    hudFrame: "帧时间",
    hudHeap: "堆",
    hudHeld: "驻留",
    hudLoaded: "已加载",
    tabOverview: "总览",
    tabFrames: "帧",
    tabAssets: "资产",
    tabMemory: "内存",
    tabTimeline: "时间线",
    close: "关闭",
    copyJson: "复制 JSON",
    copySummary: "复制摘要",
    logReport: "写入游戏日志",
    resetSession: "重新开始统计",
    copied: "已复制到剪贴板。",
    copyFailed: "无法访问剪贴板，报告已改写入游戏日志。",
    loggedToGameLog: "报告已写入游戏日志。",
    sessionLength: "本次统计",
    framesAverage: "平均",
    framesRecent: "当前",
    framePercentiles: "帧耗时",
    hitches: "超过 33ms 的卡顿帧",
    stalls: "超过 100ms 的停顿帧",
    longTasks: "长任务",
    blockingTime: "阻塞时长",
    notMeasured: "此引擎不提供该项",
    heapUsed: "JS 堆占用",
    heapPeak: "峰值",
    heapLimit: "上限",
    heldInMemory: "驻留内存",
    heldExplain: "仍被存活的 object URL 持有的负载，按类型分。",
    assetsSummary: "已加载资产",
    repeatFetches: "重复取回",
    decodeTime: "图片解码",
    failedRequests: "失败请求",
    columnAsset: "资产",
    columnKind: "类型",
    columnRequests: "次数",
    columnBytes: "字节",
    columnDecode: "解码",
    columnHeld: "驻留",
    sortBytes: "字节",
    sortRequests: "次数",
    sortDecode: "解码",
    sortRecent: "最近",
    filterPlaceholder: "筛选资产",
    noAssets: "还没有加载任何东西。",
    instrumentationOff: "资产探针已关闭，因此没有字节数与驻留数据。可在 Studio 的性能面板里打开。",
    noTimeline: "还没有发生任何事件。",
    playthrough: "游玩过程",
    scenes: "场景",
    lines: "对白行",
    choices: "选择",
    saves: "存档",
    overhead: "检查器自身开销",
    notes: "说明",
    spans: "区间",
    openSpans: "尚未结束",
    hotkeyHint: "再按一次隐藏，按住 Shift 打开完整面板。",
};

const JA: OverlayStrings = {
    title: "パフォーマンス インスペクター",
    hudFps: "fps",
    hudFrame: "フレーム",
    hudHeap: "ヒープ",
    hudHeld: "保持",
    hudLoaded: "読込済",
    tabOverview: "概要",
    tabFrames: "フレーム",
    tabAssets: "アセット",
    tabMemory: "メモリ",
    tabTimeline: "タイムライン",
    close: "閉じる",
    copyJson: "JSON をコピー",
    copySummary: "要約をコピー",
    logReport: "ゲームログに書き出す",
    resetSession: "計測をやり直す",
    copied: "クリップボードにコピーしました。",
    copyFailed: "クリップボードを利用できないため、レポートをゲームログに書き出しました。",
    loggedToGameLog: "レポートをゲームログに書き出しました。",
    sessionLength: "計測時間",
    framesAverage: "平均",
    framesRecent: "現在",
    framePercentiles: "フレーム時間",
    hitches: "33ms を超えたフレーム",
    stalls: "100ms を超えたフレーム",
    longTasks: "ロングタスク",
    blockingTime: "ブロッキング時間",
    notMeasured: "このエンジンでは計測できません",
    heapUsed: "JS ヒープ使用量",
    heapPeak: "ピーク",
    heapLimit: "上限",
    heldInMemory: "メモリ保持",
    heldExplain: "生きているオブジェクト URL がまだ保持しているデータを種類別に表示します。",
    assetsSummary: "読み込んだアセット",
    repeatFetches: "再取得",
    decodeTime: "画像デコード",
    failedRequests: "失敗した要求",
    columnAsset: "アセット",
    columnKind: "種類",
    columnRequests: "回数",
    columnBytes: "バイト",
    columnDecode: "デコード",
    columnHeld: "保持",
    sortBytes: "バイト",
    sortRequests: "回数",
    sortDecode: "デコード",
    sortRecent: "最近",
    filterPlaceholder: "アセットを絞り込む",
    noAssets: "まだ何も読み込まれていません。",
    instrumentationOff: "アセット計測が無効なため、バイト数と保持量は取得できません。Studio のパフォーマンス パネルで有効にしてください。",
    noTimeline: "まだ何も起きていません。",
    playthrough: "プレイ状況",
    scenes: "シーン",
    lines: "セリフ",
    choices: "選択",
    saves: "セーブ",
    overhead: "インスペクターの負荷",
    notes: "注記",
    spans: "区間",
    openSpans: "未終了",
    hotkeyHint: "もう一度押すと閉じ、Shift 併用で詳細パネルを開きます。",
};

/** Resolved by primary subtag, so `zh-Hans-CN` and `zh-TW` both land on the Chinese table. */
export function stringsFor(locale: string | undefined): OverlayStrings {
    const primary = (locale ?? "").toLowerCase().split(/[-_]/)[0];
    if (primary === "zh") {
        return ZH;
    }
    if (primary === "ja") {
        return JA;
    }
    return EN;
}
