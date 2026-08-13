/**
 * When a heartbeat happens, and what happens to it afterwards.
 *
 * ## What this can actually see
 *
 * Studio's plugin API has no editing signal: no "document changed", no "active
 * editor is now this scene", no save hook. What a studio entry *does* have is
 * the workspace window's DOM, and that is enough for the only question WakaTime
 * asks — was the author working just now? Keystrokes, clicks, wheel and IME
 * commits are that answer, and they are collected in the capture phase so a
 * surface that stops propagation (the blueprint canvas does) still counts.
 *
 * The events are read for their *timing only*. No key, no coordinate, no target
 * element is inspected, stored or sent; see `buildHeartbeat` for the entire
 * payload.
 *
 * ## Rhythm
 *
 * Event-driven, not polled. WakaTime's server closes a session after 15 minutes
 * of silence, so one heartbeat per two minutes of activity is enough to
 * reconstruct it — and an author who stops typing generates nothing, which is
 * the correct answer rather than a gap to paper over. The interval below exists
 * only to retry the offline queue.
 */

import {
    BULK_CHUNK,
    HEARTBEAT_INTERVAL_MS,
    buildHeartbeat,
    chunk,
    sendHeartbeats,
    shouldRetry,
    trimQueue,
    type Credentials,
    type Heartbeat,
    type SendFailureKind,
} from "./wakatime";

const FLUSH_INTERVAL_MS = 60_000;

/** Timing only — never the key, the target or the coordinates. */
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "wheel", "input", "compositionend"] as const;

export type TrackerConfig = {
    enabled: boolean;
    apiKey: string;
    entity: string;
    project: string;
    userAgent: string;
};

export type TrackerStatus = {
    queued: number;
    sending: boolean;
    /** Epoch ms of the last heartbeat recorded locally. */
    lastHeartbeatAt: number | null;
    /** Epoch ms of the last batch the server accepted. */
    lastSentAt: number | null;
    error: { kind: SendFailureKind; message: string } | null;
    /**
     * Sending is parked until the credentials change or the author retries by
     * hand. Only ever set by an auth failure: a wrong key does not become right
     * on a timer, and hammering the endpoint every minute would be rude.
     */
    pausedForAuth: boolean;
};

export type TrackerDeps = {
    readConfig(): TrackerConfig;
    readQueue(): Heartbeat[];
    writeQueue(queue: readonly Heartbeat[]): void;
    now?: () => number;
    /** Present in the workspace; injectable so the scheduling logic is testable. */
    isVisible?: () => boolean;
};

export type Tracker = {
    /** Attaches the listeners and the retry timer. Returns the cleanup. */
    start(): () => void;
    status(): TrackerStatus;
    subscribe(listener: () => void): () => void;
    /** Record one now, ignoring the two-minute gate. Used by "Send a heartbeat now". */
    recordNow(): Promise<void>;
    /** Clear a parked auth failure and try again. */
    resume(): void;
    flush(): Promise<void>;
};

/**
 * The whole rhythm rule, as one testable function: record when the window is on
 * screen and the last heartbeat is at least an interval old.
 */
export function shouldRecord(lastHeartbeatAt: number | null, at: number, visible: boolean): boolean {
    if (!visible) {
        return false;
    }
    return lastHeartbeatAt === null || at - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS;
}

export function createTracker(deps: TrackerDeps): Tracker {
    const now = deps.now ?? (() => Date.now());
    const isVisible = deps.isVisible ?? (() => document.visibilityState === "visible");

    let status: TrackerStatus = {
        queued: deps.readQueue().length,
        sending: false,
        lastHeartbeatAt: null,
        lastSentAt: null,
        error: null,
        pausedForAuth: false,
    };
    const listeners = new Set<() => void>();

    const update = (patch: Partial<TrackerStatus>) => {
        status = { ...status, ...patch };
        for (const listener of listeners) {
            listener();
        }
    };

    /** Everything needed to send, or null when the setup is incomplete. */
    const ready = (config: TrackerConfig): Credentials | null => {
        if (!config.enabled || !config.apiKey || !config.project) {
            return null;
        }
        return { apiKey: config.apiKey, userAgent: config.userAgent };
    };

    const record = (force: boolean) => {
        const config = deps.readConfig();
        if (!ready(config)) {
            return false;
        }
        const at = now();
        if (!force && !shouldRecord(status.lastHeartbeatAt, at, isVisible())) {
            return false;
        }
        const queue = trimQueue([
            ...deps.readQueue(),
            buildHeartbeat({ entity: config.entity, timeMs: at, project: config.project }),
        ]);
        deps.writeQueue(queue);
        update({ lastHeartbeatAt: at, queued: queue.length });
        return true;
    };

    const flush = async (): Promise<void> => {
        if (status.sending || status.pausedForAuth) {
            return;
        }
        const config = deps.readConfig();
        const credentials = ready(config);
        if (!credentials) {
            return;
        }
        let queue = deps.readQueue();
        if (!queue.length) {
            return;
        }

        update({ sending: true });
        try {
            for (const batch of chunk(queue, BULK_CHUNK)) {
                const outcome = await sendHeartbeats(credentials, batch);
                if (!outcome.ok && shouldRetry(outcome)) {
                    update({
                        error: { kind: outcome.kind, message: outcome.message },
                        pausedForAuth: outcome.kind === "auth",
                    });
                    return;
                }
                // Accepted, or refused in a way that will not improve — either
                // way the batch leaves the queue. Re-read rather than splice:
                // an activity event may have appended while this was in flight.
                queue = deps.readQueue().slice(batch.length);
                deps.writeQueue(queue);
                update({
                    queued: queue.length,
                    lastSentAt: outcome.ok ? now() : status.lastSentAt,
                    error: outcome.ok ? null : { kind: outcome.kind, message: outcome.message },
                });
            }
        } finally {
            update({ sending: false });
        }
    };

    const onActivity = () => {
        if (record(false)) {
            void flush();
        }
    };

    return {
        start() {
            for (const event of ACTIVITY_EVENTS) {
                window.addEventListener(event, onActivity, { capture: true, passive: true });
            }
            const timer = window.setInterval(() => void flush(), FLUSH_INTERVAL_MS);
            void flush();

            return () => {
                for (const event of ACTIVITY_EVENTS) {
                    window.removeEventListener(event, onActivity, { capture: true });
                }
                window.clearInterval(timer);
            };
        },
        status: () => status,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        async recordNow() {
            record(true);
            await flush();
        },
        resume() {
            update({ pausedForAuth: false, error: null });
            void flush();
        },
        flush,
    };
}
