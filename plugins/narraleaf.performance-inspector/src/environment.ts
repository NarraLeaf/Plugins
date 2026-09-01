/**
 * What the machine running the game will say about itself.
 *
 * Every reading is optional and every one is guarded. This runs in an Electron renderer, in a
 * browser tab and, in tests, against an object with almost nothing on it - so the function's job is
 * to report what it found rather than to insist the fields exist.
 *
 * Nothing here identifies a player. The user agent, the core count and the window size describe the
 * hardware a measurement was taken on, which is the whole reason a report is worth sending to
 * someone else; no name, no address, no storage and no identifier is read.
 */

import type { EnvironmentInfo } from "./report";

export type EnvironmentScope = {
    navigator?: {
        userAgent?: string;
        platform?: string;
        hardwareConcurrency?: number;
        deviceMemory?: number;
        language?: string;
    };
    screen?: { width?: number; height?: number };
    innerWidth?: number;
    innerHeight?: number;
    devicePixelRatio?: number;
    location?: { protocol?: string };
};

export function describeEnvironment(scope: EnvironmentScope): EnvironmentInfo {
    const info: EnvironmentInfo = {};
    const navigatorLike = scope.navigator;
    if (navigatorLike) {
        if (typeof navigatorLike.userAgent === "string") {
            info.userAgent = navigatorLike.userAgent;
        }
        if (typeof navigatorLike.platform === "string") {
            info.platform = navigatorLike.platform;
        }
        if (typeof navigatorLike.hardwareConcurrency === "number") {
            info.hardwareConcurrency = navigatorLike.hardwareConcurrency;
        }
        if (typeof navigatorLike.deviceMemory === "number") {
            info.deviceMemoryGb = navigatorLike.deviceMemory;
        }
        if (typeof navigatorLike.language === "string") {
            info.language = navigatorLike.language;
        }
    }
    if (scope.screen && typeof scope.screen.width === "number" && typeof scope.screen.height === "number") {
        info.screen = { width: scope.screen.width, height: scope.screen.height };
    }
    if (typeof scope.innerWidth === "number" && typeof scope.innerHeight === "number") {
        info.viewport = { width: scope.innerWidth, height: scope.innerHeight };
    }
    if (typeof scope.devicePixelRatio === "number") {
        info.devicePixelRatio = scope.devicePixelRatio;
    }
    if (typeof scope.location?.protocol === "string") {
        info.shell = scope.location.protocol;
    }
    return info;
}

/**
 * The object Studio's own windows are handed by their preload.
 *
 * A Dev Mode window is a Studio window - it is where Studio runs the game inside itself - so this
 * key is present there and absent from every shell that carries a build: the preview runner and a
 * packaged game get the game runtime's own bridge instead, and a web export gets neither.
 *
 * Reading a host detail by name is not lovely, and it is what there is. The protocol cannot answer
 * this (Studio loads its windows from `file:`, and so does a web export opened off disk), and the
 * plugin API has no "which environment am I" of its own.
 */
const STUDIO_RENDERER_BRIDGE_KEY = "__NLS_RENDERER_INTERFACE__";

/**
 * Whether the game is running inside Studio, which today means Dev Mode.
 *
 * This is the whole of the `studio` availability setting. A Dev Mode window is the author's own
 * machine with the editor open beside it and cannot reach a player; anything else is a build that
 * might. A preview counts as a build here deliberately - it is the same shell serving the same pack
 * as a shipped game, and there is no signal separating the two.
 *
 * An environment this cannot recognise answers `false`, so the failure mode of a future shell is a
 * profiler that stays disarmed rather than one that arms itself in front of players.
 */
export function isStudioHostedGame(scope: EnvironmentScope): boolean {
    const bridge = (scope as unknown as Record<string, unknown>)[STUDIO_RENDERER_BRIDGE_KEY];
    return typeof bridge === "object" && bridge !== null;
}
