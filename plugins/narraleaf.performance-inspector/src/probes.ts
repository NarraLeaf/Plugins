/**
 * Where the numbers come from: the frame callback, the two performance observers, and the wrappers
 * around the network and object-URL machinery.
 *
 * Everything here takes its browser as an argument. Partly so a test can drive a whole session
 * against a fake, and partly because the wrappers are the one genuinely invasive thing this plugin
 * does - a module that reaches for `window` on its own is a module you cannot prove is reversible.
 *
 * Three rules the wrappers keep, because a profiler that changes what it measures is worthless and
 * one that breaks the game is worse:
 *
 *  - **Always call through.** Every wrapper delegates first and records second; a throw from the
 *    original propagates unchanged, and a throw from the recording side is swallowed rather than
 *    turned into a failed asset load.
 *  - **Restore exactly.** {@link installProbes} returns a teardown that puts back the functions it
 *    found, and refuses to install twice over itself.
 *  - **Record nothing the game did not already do.** These wrappers observe requests; they never
 *    make one, never retry one, and never hold a reference to a response body.
 */

import type { PerformanceCollector, ResourceKind } from "./collector";

type Thenable<T> = { then<R1, R2>(onOk: (value: T) => R1, onError: (reason: unknown) => R2): Thenable<R1 | R2> };

type MemoryReading = {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
};

type PerformanceLike = {
    now(): number;
    /** Chromium only; absent everywhere else, which is what the heap page reports. */
    memory?: MemoryReading;
};

type ObserverEntry = {
    name?: string;
    entryType?: string;
    startTime?: number;
    duration?: number;
    initiatorType?: string;
    transferSize?: number;
    encodedBodySize?: number;
    decodedBodySize?: number;
};

type ObserverList = { getEntries(): ObserverEntry[] };

type PerformanceObserverLike = {
    observe(options: { type: string; buffered?: boolean }): void;
    disconnect(): void;
};

type PerformanceObserverConstructor = new (
    callback: (list: ObserverList) => void,
) => PerformanceObserverLike;

/**
 * The pieces of a browser these probes touch.
 *
 * Every field is optional and every use is guarded: this same module runs in the Dev Mode window, in
 * a packaged Electron game and in a browser tab from the web export, and the honest answer to a
 * missing one is a page that says the measurement is unavailable.
 */
export type ProbeScope = {
    performance?: PerformanceLike;
    requestAnimationFrame?: (callback: (timestamp: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
    setInterval?: (handler: () => void, ms: number) => unknown;
    clearInterval?: (handle: never) => void;
    PerformanceObserver?: PerformanceObserverConstructor;
    fetch?: (...args: unknown[]) => Thenable<unknown>;
    XMLHttpRequest?: { prototype: Record<string, unknown> };
    Response?: { prototype: Record<string, unknown> };
    URL?: {
        createObjectURL?: (source: unknown) => string;
        revokeObjectURL?: (url: string) => void;
    };
    HTMLImageElement?: { prototype: Record<string, unknown> };
    AudioContext?: { prototype: Record<string, unknown> };
};

export type ProbeTeardown = () => void;

/** Marks a function this module installed, so a second install cannot wrap its own wrapper. */
const PROBE_MARKER = "__narraleafPerformanceProbe";

function isProbe(value: unknown): boolean {
    return typeof value === "function" && (value as unknown as Record<string, unknown>)[PROBE_MARKER] === true;
}

function markProbe<T>(fn: T): T {
    (fn as unknown as Record<string, unknown>)[PROBE_MARKER] = true;
    return fn;
}

/** Never let a recording mistake surface as a failed asset load. */
function quietly(work: () => void): void {
    try {
        work();
    } catch {
        // A profiler that can break the thing it profiles is not a profiler.
    }
}

function sizeOf(value: unknown): number {
    if (typeof value !== "object" || value === null) {
        return 0;
    }
    const record = value as { size?: unknown; byteLength?: unknown };
    if (typeof record.size === "number") {
        return record.size;
    }
    if (typeof record.byteLength === "number") {
        return record.byteLength;
    }
    return 0;
}

/** A request argument in any of the three shapes `fetch` accepts. */
function urlOf(input: unknown): string {
    if (typeof input === "string") {
        return input;
    }
    if (input instanceof URL) {
        return input.toString();
    }
    if (typeof input === "object" && input !== null) {
        const request = input as { url?: unknown };
        if (typeof request.url === "string") {
            return request.url;
        }
    }
    return "";
}

const INITIATOR_KINDS: Record<string, ResourceKind> = {
    img: "image",
    image: "image",
    audio: "audio",
    video: "video",
    css: "style",
    link: "style",
    script: "script",
    navigation: "document",
    iframe: "document",
};

export type FrameSamplerOptions = {
    scope: ProbeScope;
    collector: PerformanceCollector;
};

/**
 * The frame loop.
 *
 * It measures its own cost on every tick and hands that to the collector, because the first question
 * anyone asks a profiler is whether the numbers include the profiler.
 */
export function installFrameSampler({ scope, collector }: FrameSamplerOptions): ProbeTeardown {
    const request = scope.requestAnimationFrame;
    const cancel = scope.cancelAnimationFrame;
    const clock = scope.performance;
    if (typeof request !== "function" || !clock) {
        return () => undefined;
    }
    let running = true;
    let handle = 0;
    const tick = (timestamp: number): void => {
        if (!running) {
            return;
        }
        const enteredAt = clock.now();
        collector.frame(timestamp);
        collector.overhead(clock.now() - enteredAt);
        handle = request.call(scope, tick);
    };
    handle = request.call(scope, tick);
    return () => {
        running = false;
        if (typeof cancel === "function") {
            cancel.call(scope, handle);
        }
    };
}

/** Chromium's heap counters, once a second. Absent elsewhere, and the heap page says so. */
export function installHeapSampler({ scope, collector }: FrameSamplerOptions): ProbeTeardown {
    const clock = scope.performance;
    const start = scope.setInterval;
    const stop = scope.clearInterval;
    if (!clock?.memory || typeof start !== "function") {
        return () => undefined;
    }
    const sample = (): void => {
        const memory = clock.memory;
        if (!memory) {
            return;
        }
        collector.heap({
            usedBytes: memory.usedJSHeapSize,
            totalBytes: memory.totalJSHeapSize,
            limitBytes: memory.jsHeapSizeLimit,
        });
    };
    sample();
    const handle = start.call(scope, sample, 1000);
    return () => {
        if (typeof stop === "function") {
            (stop as (handle: unknown) => void).call(scope, handle);
        }
    };
}

export function installLongTaskObserver({ scope, collector }: FrameSamplerOptions): ProbeTeardown {
    const Observer = scope.PerformanceObserver;
    if (typeof Observer !== "function") {
        collector.setLongTasksSupported(false);
        return () => undefined;
    }
    try {
        const observer = new Observer(list => {
            for (const entry of list.getEntries()) {
                collector.longTask(entry.duration ?? 0);
            }
        });
        observer.observe({ type: "longtask", buffered: true });
        collector.setLongTasksSupported(true);
        return () => quietly(() => observer.disconnect());
    } catch {
        // Not every engine ships the long-task entry type; saying so beats reporting zero of them.
        collector.setLongTasksSupported(false);
        return () => undefined;
    }
}

/**
 * The browser's own account of what it fetched.
 *
 * This is the only source that sees a load no wrapper can reach - an image element's `src`, a font
 * pulled in by a stylesheet, the document itself. Its byte counts are zero whenever the response is
 * cross-origin without a timing-allow header, which on this shell's custom protocol is every asset,
 * so it contributes addresses and timings and lets the wrappers contribute sizes.
 */
export function installResourceTimingObserver({ scope, collector }: FrameSamplerOptions): ProbeTeardown {
    const Observer = scope.PerformanceObserver;
    if (typeof Observer !== "function") {
        return () => undefined;
    }
    try {
        const observer = new Observer(list => {
            for (const entry of list.getEntries()) {
                const url = entry.name;
                if (!url) {
                    continue;
                }
                collector.timing({
                    url,
                    at: entry.startTime,
                    durationMs: entry.duration ?? 0,
                    bytes: entry.encodedBodySize || entry.transferSize || entry.decodedBodySize || 0,
                    initiatorKind: entry.initiatorType ? INITIATOR_KINDS[entry.initiatorType] : undefined,
                });
            }
        });
        observer.observe({ type: "resource", buffered: true });
        return () => quietly(() => observer.disconnect());
    } catch {
        return () => undefined;
    }
}

/**
 * The wrappers: `fetch`, `XMLHttpRequest`, the two response-body readers, the object-URL factory and
 * image decoding.
 *
 * The object-URL half is what answers "what is still in memory". The engine's image cache fetches
 * bytes, turns them into a blob, makes an object URL and keeps that URL alive for as long as it
 * intends to keep the picture - so a URL created and not revoked is a payload the process is still
 * holding. Tying the blob back to the address it came from is what the weak map is for, and it is
 * weak because a profiler must not be the reason a blob cannot be collected.
 */
export function installNetworkProbes({ scope, collector }: FrameSamplerOptions): ProbeTeardown {
    const clock = scope.performance;
    if (!clock) {
        return () => undefined;
    }
    const teardowns: ProbeTeardown[] = [];
    const blobOrigins = new WeakMap<object, string>();
    /**
     * Array buffers, tied back to the address they were read from.
     *
     * Separate from {@link blobOrigins} because the two are handed to different decoders: a blob
     * becomes an object URL and then an image, an array buffer goes straight to `decodeAudioData`.
     * Both are weak, so tracking a payload never keeps it alive.
     */
    const bufferOrigins = new WeakMap<object, string>();

    const originalFetch = scope.fetch;
    if (typeof originalFetch === "function" && !isProbe(originalFetch)) {
        const patched = markProbe(function patchedFetch(this: unknown, ...args: unknown[]) {
            const url = urlOf(args[0]);
            const startedAt = clock.now();
            const finish = (contentType: string | null, failed: boolean): void => {
                quietly(() => {
                    collector.request({
                        url,
                        at: startedAt,
                        durationMs: clock.now() - startedAt,
                        contentType,
                        failed,
                    });
                });
            };
            let pending: Thenable<unknown>;
            try {
                pending = originalFetch.apply(this, args);
            } catch (error) {
                finish(null, true);
                throw error;
            }
            return pending.then(
                response => {
                    const headers = (response as { headers?: { get?: (name: string) => string | null } })?.headers;
                    const ok = (response as { ok?: boolean })?.ok !== false;
                    finish(headers?.get?.("content-type") ?? null, !ok);
                    return response;
                },
                error => {
                    finish(null, true);
                    throw error;
                },
            );
        });
        scope.fetch = patched as ProbeScope["fetch"];
        teardowns.push(() => {
            scope.fetch = originalFetch;
        });
    }

    const responseProto = scope.Response?.prototype;
    if (responseProto) {
        for (const method of ["blob", "arrayBuffer"] as const) {
            const original = responseProto[method];
            if (typeof original !== "function" || isProbe(original)) {
                continue;
            }
            const originalReader = original as (this: unknown) => Thenable<unknown>;
            const patched = markProbe(function patchedReader(this: { url?: string }) {
                const url = typeof this?.url === "string" ? this.url : "";
                return originalReader.call(this).then(
                    body => {
                        quietly(() => {
                            if (!url) {
                                return;
                            }
                            const bytes = sizeOf(body);
                            const type = (body as { type?: unknown })?.type;
                            collector.resourceBytes(url, bytes, typeof type === "string" ? type : null);
                            if (typeof body === "object" && body !== null) {
                                // The tie between a payload and the address its bytes came from.
                                // Weak, so holding it never keeps a payload alive.
                                (method === "blob" ? blobOrigins : bufferOrigins).set(body as object, url);
                            }
                        });
                        return body;
                    },
                    error => {
                        throw error;
                    },
                );
            });
            responseProto[method] = patched;
            teardowns.push(() => {
                responseProto[method] = original;
            });
        }
    }

    const urlFactory = scope.URL;
    const originalCreate = urlFactory?.createObjectURL;
    if (urlFactory && typeof originalCreate === "function" && !isProbe(originalCreate)) {
        const patched = markProbe(function patchedCreateObjectUrl(this: unknown, source: unknown) {
            const objectUrl = originalCreate.call(urlFactory, source);
            quietly(() => {
                const origin = typeof source === "object" && source !== null
                    ? blobOrigins.get(source as object) ?? null
                    : null;
                collector.retain(objectUrl, origin, sizeOf(source));
            });
            return objectUrl;
        });
        urlFactory.createObjectURL = patched;
        teardowns.push(() => {
            urlFactory.createObjectURL = originalCreate;
        });
    }
    const originalRevoke = urlFactory?.revokeObjectURL;
    if (urlFactory && typeof originalRevoke === "function" && !isProbe(originalRevoke)) {
        const patched = markProbe(function patchedRevokeObjectUrl(this: unknown, objectUrl: string) {
            quietly(() => collector.release(objectUrl));
            originalRevoke.call(urlFactory, objectUrl);
        });
        urlFactory.revokeObjectURL = patched;
        teardowns.push(() => {
            urlFactory.revokeObjectURL = originalRevoke;
        });
    }

    const imageProto = scope.HTMLImageElement?.prototype;
    const originalDecode = imageProto?.decode;
    if (imageProto && typeof originalDecode === "function" && !isProbe(originalDecode)) {
        const decode = originalDecode as (this: unknown) => Thenable<unknown>;
        const patched = markProbe(function patchedDecode(this: { currentSrc?: string; src?: string }) {
            const startedAt = clock.now();
            const source = this?.currentSrc || this?.src || "";
            const record = (): void => {
                quietly(() => {
                    if (source) {
                        collector.decode(source, clock.now() - startedAt);
                    }
                });
            };
            return decode.call(this).then(
                value => {
                    record();
                    return value;
                },
                error => {
                    record();
                    throw error;
                },
            );
        });
        imageProto.decode = patched;
        teardowns.push(() => {
            imageProto.decode = originalDecode;
        });
    }

    const audioProto = scope.AudioContext?.prototype;
    const originalDecodeAudio = audioProto?.decodeAudioData;
    if (audioProto && typeof originalDecodeAudio === "function" && !isProbe(originalDecodeAudio)) {
        const decodeAudio = originalDecodeAudio as (this: unknown, ...args: unknown[]) => Thenable<unknown>;
        const patched = markProbe(function patchedDecodeAudioData(this: unknown, ...args: unknown[]) {
            const startedAt = clock.now();
            // Read before delegating: decoding detaches the buffer, and an address read afterwards
            // would be an address read off something the caller no longer owns.
            const source = typeof args[0] === "object" && args[0] !== null
                ? bufferOrigins.get(args[0] as object) ?? ""
                : "";
            const record = (): void => {
                quietly(() => {
                    if (source) {
                        collector.decode(source, clock.now() - startedAt, "audio");
                    }
                });
            };
            return decodeAudio.apply(this, args).then(
                value => {
                    record();
                    return value;
                },
                error => {
                    record();
                    throw error;
                },
            );
        });
        audioProto.decodeAudioData = patched;
        teardowns.push(() => {
            audioProto.decodeAudioData = originalDecodeAudio;
        });
    }

    const xhrProto = scope.XMLHttpRequest?.prototype;
    const originalOpen = xhrProto?.open;
    const originalSend = xhrProto?.send;
    if (xhrProto && typeof originalOpen === "function" && typeof originalSend === "function" && !isProbe(originalSend)) {
        type XhrState = { url: string; startedAt: number };
        const pending = new WeakMap<object, XhrState>();
        const open = originalOpen as (this: object, ...args: unknown[]) => unknown;
        const send = originalSend as (this: object, ...args: unknown[]) => unknown;

        const patchedOpen = markProbe(function patchedXhrOpen(this: object, ...args: unknown[]) {
            quietly(() => {
                pending.set(this, { url: urlOf(args[1]), startedAt: 0 });
            });
            return open.apply(this, args);
        });
        const patchedSend = markProbe(function patchedXhrSend(this: object, ...args: unknown[]) {
            quietly(() => {
                const state = pending.get(this);
                if (!state) {
                    return;
                }
                state.startedAt = clock.now();
                const target = this as {
                    addEventListener?: (type: string, listener: () => void, options?: unknown) => void;
                    status?: number;
                    response?: unknown;
                };
                target.addEventListener?.(
                    "loadend",
                    () => {
                        quietly(() => {
                            const status = typeof target.status === "number" ? target.status : 0;
                            collector.request({
                                url: state.url,
                                at: state.startedAt,
                                durationMs: clock.now() - state.startedAt,
                                bytes: sizeOf(target.response) || undefined,
                                failed: status !== 0 && status >= 400,
                            });
                            if (typeof target.response === "object" && target.response !== null) {
                                // Howler reads audio through XHR, so this is where a clip's bytes
                                // get their address before `decodeAudioData` sees them.
                                bufferOrigins.set(target.response as object, state.url);
                            }
                        });
                    },
                    { once: true },
                );
            });
            return send.apply(this, args);
        });
        xhrProto.open = patchedOpen;
        xhrProto.send = patchedSend;
        teardowns.push(() => {
            xhrProto.open = originalOpen;
            xhrProto.send = originalSend;
        });
    }

    collector.setInstrumented(teardowns.length > 0);
    return () => {
        for (const teardown of teardowns.reverse()) {
            quietly(teardown);
        }
        collector.setInstrumented(false);
    };
}

export type InstallProbesOptions = FrameSamplerOptions & {
    /** When false, the wrappers are skipped and only the passive observers run. */
    instrumentAssets: boolean;
};

/** Everything at once, with one teardown that undoes it in the reverse order. */
export function installProbes(options: InstallProbesOptions): ProbeTeardown {
    const teardowns: ProbeTeardown[] = [
        installFrameSampler(options),
        installHeapSampler(options),
        installLongTaskObserver(options),
        installResourceTimingObserver(options),
    ];
    if (options.instrumentAssets) {
        teardowns.push(installNetworkProbes(options));
    }
    return () => {
        for (const teardown of teardowns.reverse()) {
            quietly(teardown);
        }
    };
}
