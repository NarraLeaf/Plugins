/**
 * Ambient declarations for the NarraLeaf Studio plugin host modules.
 *
 * ---------------------------------------------------------------------------
 * STOPGAP. Studio does not yet publish a types package for `narraleaf-studio/*`.
 * These specifiers resolve only at runtime, through an import map the host
 * installs, and at build time they are marked `external` — nothing on disk
 * backs them. Until an official types package ships, every plugin carries a
 * copy of this file.
 *
 * The plugin-facing surface below (definePlugin, PluginApp, PluginServices,
 * defineRuntimePlugin) is transcribed from Studio's source and is accurate.
 * Deep editor structures — the execute context, panel and widget definitions,
 * the privileged facade — are typed permissively on purpose: mirroring them by
 * hand would create a second source of truth that silently drifts. Prefer a
 * runtime check over trusting a `Record<string, any>` here.
 *
 * Upstream:
 *   src/renderer/plugin/index.ts
 *   src/renderer/lib/ui-editor/runtime/plugins/runtimePluginApi.ts
 *   src/renderer/lib/ui-editor/blueprint-nodes/types.ts
 * ---------------------------------------------------------------------------
 */

declare module "narraleaf-studio/plugin" {
    export type PluginIdentity = {
        pluginId: string;
        version: string;
    };

    export type NormalizedPluginManifestV2 = {
        manifestVersion: 2;
        id: string;
        name: string;
        version: string;
        description?: string;
        publisher?: string;
        entries: { studio?: string; runtime?: string };
        contributes: { blueprintNodes: string[]; widgets: string[] };
        permissions: PluginInstallPermission[];
    };

    export type PluginInstallPermission =
        | { kind: "filesystem"; path: string; mode: "read" | "write" | "readwrite"; recursive: boolean }
        | { kind: "api"; capability: string };

    export type BlueprintPinSemantic = "exec" | "data";

    export type BlueprintNodePinDef = {
        id: string;
        kind: "input" | "output";
        semantic: BlueprintPinSemantic;
        /** Loose type tag for data pins (e.g. "boolean", "string", "integer", "float"). */
        valueType?: string;
        label?: string;
        /** Optional inputs render inactive until wired. */
        optional?: boolean;
        /** Allows an on-card literal editor when unwired. Data inputs only. */
        allowInlineLiteral?: boolean;
    };

    /**
     * Execution context. Loosely typed — see the file header. `inputValues`
     * holds resolved data-pin values; `hostAdapter` exposes the game host APIs
     * (save/load, variables, …) and is absent in some editor preview contexts,
     * so check before use.
     */
    export type BlueprintNodeExecuteContext = {
        inputValues?: Record<string, any>;
        params?: Record<string, any>;
        hostAdapter?: Record<string, any>;
        [key: string]: any;
    };

    export type BlueprintNodeExecuteResult = {
        nextPort?: string | undefined;
        outputValues?: Record<string, any>;
    } | void;

    export type BlueprintNodeExecuteFn = (
        ctx: BlueprintNodeExecuteContext,
    ) => BlueprintNodeExecuteResult | Promise<BlueprintNodeExecuteResult>;

    export type BlueprintGraphKind = "event" | "macro" | "function" | (string & {});

    export type BlueprintNodeDef = {
        /** Must be prefixed with the plugin id and declared in manifest.json. */
        type: string;
        displayName: string;
        category: string;
        keywords?: string[];
        graphKinds: BlueprintGraphKind[];
        hideInPalette?: boolean;
        /** Pure nodes have no side effects. */
        isPure: boolean;
        /** Latent/async execution; disallowed in function graphs. */
        isLatent?: boolean;
        pins: BlueprintNodePinDef[];
        inspectorParams?: Record<string, any>[];
        execute: BlueprintNodeExecuteFn;
        [key: string]: any;
    };

    export type BlueprintInspectorParamSelectOption = {
        value: string;
        label: string;
        [key: string]: any;
    };

    export type PluginCleanup = () => void | Promise<void>;

    export type PluginStorageService = {
        readJson<T extends Record<string, any>>(namespace: string): Promise<T | null>;
        writeJson<T extends Record<string, any>>(namespace: string, data: T): Promise<void>;
    };

    export type PluginAssetsService = {
        getMap(): any;
        list(type: string): any[];
        get(type: string, assetId: string): any | undefined;
        fetch(asset: any): Promise<any>;
        createObjectUrl(asset: any): Promise<string>;
        revokeObjectUrl(url: string): void;
    };

    /**
     * The curated plugin API surface. Intentionally a whitelist: plugins do NOT
     * get the workspace service registry. Anything beyond this (arbitrary file
     * system access, bash) goes through `app.privileged`, which the main
     * process audits per plugin.
     */
    export type PluginServices = {
        storage: PluginStorageService;
        assets: PluginAssetsService;
        ui: {
            panels: {
                register(panel: Record<string, any>): void;
                unregister(id: string): void;
            };
            actions: {
                register(action: Record<string, any>): void;
                unregister(id: string): void;
                registerGroup(group: Record<string, any>): void;
                unregisterGroup(id: string): void;
            };
            editors: {
                open(tab: Record<string, any>, groupId?: string): void;
                close(tabId: string, groupId?: string): void;
            };
            keybindings: {
                register(keybinding: Record<string, any>): PluginCleanup;
                registerMany(keybindings: Record<string, any>[]): PluginCleanup;
            };
            notifications: {
                info(message: string): void;
                success(message: string): void;
                warning(message: string): void;
                error(message: string): void;
            };
        };
        widgets: {
            register(module: Record<string, any>): void;
            registerMany(modules: Record<string, any>[]): void;
            get(type: string): Record<string, any> | undefined;
            list(): Record<string, any>[];
            has(type: string): boolean;
        };
        story: {
            actions: {
                /** Action ids must be prefixed with the plugin id. */
                register(registration: Record<string, any>): PluginCleanup;
            };
        };
        blueprintNodes: {
            register(def: BlueprintNodeDef): void;
            registerMany(defs: BlueprintNodeDef[]): void;
            registerDynamicSelectOptionsSource(
                sourceId: string,
                provider: () => BlueprintInspectorParamSelectOption[],
            ): PluginCleanup;
            notifyDynamicSelectOptionsChanged(): void;
        };
    };

    export type PluginApp = {
        plugin: PluginIdentity;
        manifest: NormalizedPluginManifestV2;
        services: PluginServices;
        /** Gated by manifest.json permissions and audited per plugin. */
        privileged: Record<string, any>;
    };

    export type PluginSetupResult = void | PluginCleanup;
    export type PluginSetup = (app: PluginApp) => PluginSetupResult | Promise<PluginSetupResult>;
    export type PluginDefinition = { setup: PluginSetup };

    export function definePlugin(definition: PluginDefinition): PluginDefinition;
    export function isPluginDefinition(value: unknown): value is PluginDefinition;

    /** Prebuilt panel primitives, so plugin UI matches Studio's chrome. */
    export const ui: Record<string, any>;
}

declare module "narraleaf-studio/runtime" {
    import type { ReactElement } from "react";
    import type { BlueprintNodeExecuteFn, NormalizedPluginManifestV2, PluginIdentity } from "narraleaf-studio/plugin";

    export type RuntimePluginLogLevel = "info" | "warning" | "error";

    /**
     * Runtime-side binding: only the execute half. A full editor
     * `BlueprintNodeDef` is a superset and can be passed directly — extra
     * fields are ignored.
     */
    export type RuntimeBlueprintNodeDef = {
        type: string;
        displayName?: string;
        execute: BlueprintNodeExecuteFn;
    };

    export type RuntimeWidgetRendererDef = {
        type: string;
        render: (props: Record<string, any>) => ReactElement | null;
    };

    export type RuntimePluginApp = {
        plugin: PluginIdentity;
        manifest: NormalizedPluginManifestV2;
        game: {
            blueprintNodes: {
                register(def: RuntimeBlueprintNodeDef): void;
                registerMany(defs: RuntimeBlueprintNodeDef[]): void;
            };
            widgets: {
                register(def: RuntimeWidgetRendererDef): void;
                registerMany(defs: RuntimeWidgetRendererDef[]): void;
            };
            log(level: RuntimePluginLogLevel, message: string): void;
        };
    };

    /** Game environments load once per process — no cleanup return. */
    export type RuntimePluginSetup = (app: RuntimePluginApp) => void | Promise<void>;
    export type RuntimePluginDefinition = { setup: RuntimePluginSetup };

    export function defineRuntimePlugin(definition: RuntimePluginDefinition): RuntimePluginDefinition;
    export function isRuntimePluginDefinition(value: unknown): value is RuntimePluginDefinition;
}
