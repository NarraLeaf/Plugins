import { definePlugin, PanelPosition, type PluginCleanup } from "narraleaf-studio/plugin";
import { createTools } from "./agent/tools";
import { BridgeRailIcon } from "./icon";
import { PANEL_ID } from "./ids";
import { MESSAGES } from "./messages";
import { openQuestionCount } from "./model";
import { BridgePanel } from "./panel/BridgePanel";
import { BridgeStore } from "./store";
import { voiceLedgerTest } from "./tests";

export default definePlugin({
    async setup(app) {
        const store = new BridgeStore(app.services.storage, app.services.workspace);
        await store.load();
        const translator = app.services.i18n.createTranslator(MESSAGES);
        const notify = app.services.ui.notifications;

        // One component for every registration below: registering the panel again with a new title
        // then keeps an open panel mounted, with whatever the author was typing in it.
        const Panel = () => <BridgePanel app={app} store={store} translator={translator} />;
        const icon = <BridgeRailIcon store={store} />;

        // Studio's plugin API cannot change a registered panel's title, and draws no badge on a
        // sidebar icon. Registering the same id again replaces the panel in place, so the title (the
        // rail's tooltip and the panel's header) carries the count of open questions that way; the
        // icon draws its own dot.
        let title = "";
        let unregisterPanel: PluginCleanup = () => {};
        const registerPanel = () => {
            const open = openQuestionCount(store.snapshot.decisions);
            const next = open ? translator.t("panel.titleWaiting", { name: app.manifest.name, count: open }) : app.manifest.name;
            if (next === title) return;
            title = next;
            unregisterPanel = app.services.ui.panels.register({
                id: PANEL_ID,
                title,
                icon,
                position: PanelPosition.Left,
                order: 900,
                component: Panel,
            });
        };
        registerPanel();

        const cleanups: PluginCleanup[] = [
            app.services.workspace.registerReloader(() => store.load()),
            () => unregisterPanel(),
            app.services.i18n.onLocaleChange(() => {
                title = "";
                registerPanel();
            }),
            app.services.agent.registerTools(createTools(app, store)),
            app.services.tests.register(voiceLedgerTest(app, store, translator)),
        ];

        // Questions left open from an earlier session: say so as the project opens, since the one
        // notification each got when it was asked is long gone.
        const waiting = openQuestionCount(store.snapshot.decisions);
        if (waiting) notify.info(translator.t("notify.waiting", { count: waiting }));

        // Tell the author when the agent asks something, wherever they are in Studio.
        let known = new Set(store.snapshot.decisions.items.map(item => item.id));
        cleanups.push(store.subscribe(() => {
            const items = store.snapshot.decisions.items;
            for (const item of items) {
                if (!known.has(item.id) && item.origin === "agent" && item.status === "open") {
                    notify.info(translator.t("notify.question", { question: item.question }));
                }
            }
            known = new Set(items.map(item => item.id));
            registerPanel();
        }));

        return async () => {
            for (const cleanup of cleanups.reverse()) await cleanup();
        };
    },
});
