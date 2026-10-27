import { definePlugin, PanelPosition } from "narraleaf-studio/plugin";
import { createTools } from "./agent/tools";
import { Ren2LeafMark } from "./icon";
import { PANEL_ID } from "./ids";
import { MESSAGES } from "./messages";
import { BridgePanel } from "./panel/BridgePanel";
import { BridgeStore } from "./store";
import { voiceLedgerTest } from "./tests";

export default definePlugin({
    async setup(app) {
        const store = new BridgeStore(app.services.storage, app.services.workspace);
        await store.load();
        const translator = app.services.i18n.createTranslator(MESSAGES);

        const cleanups = [
            app.services.workspace.registerReloader(() => store.load()),
            app.services.ui.panels.register({
                id: PANEL_ID,
                title: app.manifest.name,
                icon: <Ren2LeafMark />,
                position: PanelPosition.Left,
                order: 900,
                component: () => <BridgePanel app={app} store={store} translator={translator} />,
            }),
            app.services.agent.registerTools(createTools(app, store)),
            app.services.tests.register(voiceLedgerTest(app, store, translator)),
        ];

        // Tell the author when the agent asks something, wherever they are in Studio.
        let known = new Set(store.snapshot.decisions.items.map(item => item.id));
        cleanups.push(store.subscribe(() => {
            const items = store.snapshot.decisions.items;
            for (const item of items) {
                if (!known.has(item.id) && item.origin === "agent" && item.status === "open") {
                    app.services.ui.notifications.info(translator.t("notify.question", { question: item.question }));
                }
            }
            known = new Set(items.map(item => item.id));
        }));

        return async () => {
            for (const cleanup of cleanups.reverse()) await cleanup();
        };
    },
});
