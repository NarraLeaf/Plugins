/**
 * Studio entry — runs in the editor process.
 *
 * This plugin is a Studio *language pack*: its whole payload is the declarative
 * `contributes.locales` catalog in manifest.json (`locales/zh-x-neko.json`). The
 * host reads that catalog in the main process, aggregates it into the shared
 * locale registry, and exposes it as a first-class locale everywhere (the
 * Settings language picker, formatters, `<html lang>`, the native menu). None of
 * that needs an imperative registration.
 *
 * An entry is declared only because the manifest validator requires at least one
 * of `studio` / `runtime`; there is nothing to register, so setup is a no-op.
 */

import { definePlugin } from "narraleaf-studio/plugin";

export default definePlugin({
    setup() {
        // Intentionally empty: the language pack is loaded declaratively from
        // manifest.json `contributes.locales`, not registered here.
    },
});
