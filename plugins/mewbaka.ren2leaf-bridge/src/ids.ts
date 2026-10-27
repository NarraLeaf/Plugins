/** The plugin's id; every namespace, tool, panel and test below is prefixed with it. */
export const PLUGIN_ID = "mewbaka.ren2leaf-bridge";

/** Storage namespaces, split by how often they are written: `writeJson` rewrites a namespace whole. */
export const NS = {
    pack: `${PLUGIN_ID}.pack`,
    inventory: `${PLUGIN_ID}.inventory`,
    screens: `${PLUGIN_ID}.screens`,
    images: `${PLUGIN_ID}.images`,
    ledger: `${PLUGIN_ID}.ledger`,
    decisions: `${PLUGIN_ID}.decisions`,
    issues: `${PLUGIN_ID}.issues`,
    log: `${PLUGIN_ID}.log`,
    lines: `${PLUGIN_ID}.lines`,
} as const;

export type NamespaceKey = keyof typeof NS;

export const TOOL = {
    portStatus: `${PLUGIN_ID}.port_status`,
    packSection: `${PLUGIN_ID}.pack_section`,
    packQuery: `${PLUGIN_ID}.pack_query`,
    packScreen: `${PLUGIN_ID}.pack_screen`,
    packImage: `${PLUGIN_ID}.pack_image`,
    voiceCheck: `${PLUGIN_ID}.voice_check`,
    ledgerUpsert: `${PLUGIN_ID}.ledger_upsert`,
    decisionAsk: `${PLUGIN_ID}.decision_ask`,
    decisionSeen: `${PLUGIN_ID}.decision_seen`,
    issueAdd: `${PLUGIN_ID}.issue_add`,
    logNote: `${PLUGIN_ID}.log_note`,
    linesRecord: `${PLUGIN_ID}.lines_record`,
} as const;

/** The name an MCP client sees: dots and hyphens become underscores, plugin and tool joined by `__`. */
export function advertisedName(toolName: string): string {
    const tool = toolName.slice(PLUGIN_ID.length + 1);
    return `${PLUGIN_ID.replace(/[.-]/g, "_")}__${tool.replace(/[.-]/g, "_")}`;
}

export const TEST_VOICE_LEDGER = `${PLUGIN_ID}.voice-ledger`;
export const PANEL_ID = `${PLUGIN_ID}.panel`;
