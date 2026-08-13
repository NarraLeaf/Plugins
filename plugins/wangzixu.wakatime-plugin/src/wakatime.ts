/**
 * The WakaTime wire format, and everything about talking to wakatime.com.
 *
 * Deliberately free of Studio types and of DOM state, so the parts that decide
 * *what gets sent* and *what a failure means* can be tested without a browser.
 * The only impure things here are the two `fetch` calls at the bottom.
 *
 * Why the plugin speaks HTTP itself rather than shelling out to `wakatime-cli`,
 * which is what every editor plugin WakaTime ships does: Studio's privileged
 * facade exposes `bash.execute`, but the main process handler answers
 * "Bash execution is not implemented yet" — there is no way to run the CLI. The
 * API is documented and stable, so this speaks it directly and reimplements the
 * one thing the CLI would have given us for free: an offline queue.
 */

export const WAKATIME_API_URL = "https://api.wakatime.com/api/v1";

/**
 * Fixed, not configurable. Three settings is what this plugin has room for, and
 * a dropdown nobody changes is not one of them — `designing` is what authoring a
 * visual novel is, and `NarraLeaf` is what it is authored in.
 */
export const CATEGORY = "designing";
export const LANGUAGE = "NarraLeaf";

/**
 * How long one heartbeat is allowed to stand for. WakaTime's own convention,
 * shared by every official editor plugin: while you keep working, one heartbeat
 * every two minutes is enough for the server to reconstruct a session (it closes
 * a session after 15 minutes of silence).
 */
export const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;

/** `heartbeats.bulk` accepts at most 25 per request. */
export const BULK_CHUNK = 25;

/**
 * Hard cap on the offline queue. At one heartbeat per two minutes this is about
 * 33 hours of unsent work — far past the point where a server is "briefly down"
 * and into "this key is wrong and nobody noticed". Oldest goes first.
 */
export const QUEUE_LIMIT = 1000;

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * One heartbeat, as the API takes it.
 *
 * `type: "app"` rather than `"file"`, and that is a statement about what this
 * plugin honestly knows. Studio's plugin API has no "active document" signal —
 * no open-editor event, no focused-asset accessor — so a file path would be a
 * guess dressed as a fact. The project is real (the author names it); the
 * application is real; the file is not knowable, so it is not claimed.
 */
export type Heartbeat = {
    entity: string;
    type: "app";
    /** Epoch **seconds**, fractional. Not milliseconds — the API reads seconds. */
    time: number;
    project?: string;
    language?: string;
    category?: string;
    is_write: false;
};

export type HeartbeatInput = {
    entity: string;
    /** Epoch milliseconds, as `Date.now()` produces it. */
    timeMs: number;
    project: string;
};

export function buildHeartbeat(input: HeartbeatInput): Heartbeat {
    const project = input.project.trim();
    return {
        entity: input.entity,
        type: "app",
        time: input.timeMs / 1000,
        // Omitted rather than sent empty: WakaTime files an empty string under a
        // project literally named "", which is worse than "Unknown Project".
        ...(project ? { project } : {}),
        language: LANGUAGE,
        category: CATEGORY,
        is_write: false,
    };
}

/* --------------------------------------------------------------- transport */

export type SendFailureKind =
    /** The key is wrong or revoked. Retrying on a timer just burns the queue's clock. */
    | "auth"
    /** The server understood and refused. The batch is not going to become valid. */
    | "rejected"
    | "rateLimit"
    | "server"
    | "network";

export type SendFailure = {
    ok: false;
    kind: SendFailureKind;
    status?: number;
    message: string;
};

export type SendOutcome = { ok: true } | SendFailure;

/** Whether a failure is worth keeping the batch queued for. */
export function shouldRetry(outcome: SendOutcome): boolean {
    return !outcome.ok && outcome.kind !== "rejected";
}

export function classifyStatus(status: number, body?: string): SendOutcome {
    return status >= 200 && status < 300 ? { ok: true } : failureFromStatus(status, body);
}

/**
 * The non-2xx half, split out so a caller that already knows the response failed
 * gets a type that says so — a `TodayTotal | SendOutcome` union would leave every
 * error branch pretending `{ ok: true }` were still possible.
 */
export function failureFromStatus(status: number, body?: string): SendFailure {
    if (status === 401 || status === 403) {
        return { ok: false, kind: "auth", status, message: body || "API key rejected" };
    }
    if (status === 429) {
        return { ok: false, kind: "rateLimit", status, message: body || "Rate limited" };
    }
    if (status >= 500) {
        return { ok: false, kind: "server", status, message: body || `Server error ${status}` };
    }
    return { ok: false, kind: "rejected", status, message: body || `Request rejected (${status})` };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        out.push(items.slice(index, index + size));
    }
    return out;
}

/** Keep the newest `limit`; a full queue drops its oldest entries, not its newest. */
export function trimQueue(queue: readonly Heartbeat[], limit: number = QUEUE_LIMIT): Heartbeat[] {
    return queue.length <= limit ? [...queue] : queue.slice(queue.length - limit);
}

/**
 * The `plugin` field is how WakaTime names the editor on the dashboard: it reads
 * the second-to-last `name/version` pair. Studio's version is genuinely not
 * exposed to plugins, so it is reported as `unknown` rather than invented.
 */
export function userAgent(pluginVersion: string, studioVersion = "unknown"): string {
    return `narraleaf-studio/${studioVersion} narraleaf-wakatime/${pluginVersion}`;
}

export function encodeApiKey(apiKey: string): string {
    const bytes = new TextEncoder().encode(apiKey);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

export type Credentials = {
    apiKey: string;
    userAgent: string;
};

function headers(credentials: Credentials): Record<string, string> {
    return {
        "Content-Type": "application/json",
        Authorization: `Basic ${encodeApiKey(credentials.apiKey)}`,
    };
}

/**
 * Studio's `app://` scheme is registered `corsEnabled`, so a plugin's `fetch` is
 * an ordinary cross-origin request and every endpoint used here has to survive a
 * CORS preflight. Measured against api.wakatime.com: `heartbeats.bulk` and
 * `statusbar/today` both pass with an `Authorization` header — but
 * `GET /users/current` answers its error responses without
 * `Access-Control-Allow-Origin`, so the browser eats them and the plugin sees an
 * opaque "Failed to fetch". That is why the connection test below is a
 * `statusbar/today` call and not the obvious `/users/current` one.
 */
async function request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/** Truncated: a proxy that answers an HTML error page must not become the toast. */
async function readError(response: Response): Promise<string> {
    try {
        return (await response.text()).trim().slice(0, 200);
    } catch {
        return "";
    }
}

export async function sendHeartbeats(
    credentials: Credentials,
    batch: readonly Heartbeat[],
): Promise<SendOutcome> {
    if (!batch.length) {
        return { ok: true };
    }
    try {
        const response = await request(`${WAKATIME_API_URL}/users/current/heartbeats.bulk`, {
            method: "POST",
            headers: headers(credentials),
            // `plugin` is a per-heartbeat field, not a header: `User-Agent` is a
            // forbidden header name in a renderer and would be dropped silently.
            body: JSON.stringify(batch.map(beat => ({ ...beat, plugin: credentials.userAgent }))),
        });
        return classifyStatus(response.status, response.ok ? "" : await readError(response));
    } catch (error) {
        // Offline, DNS failure, aborted timeout. Keep the batch.
        return { ok: false, kind: "network", message: errorMessage(error) };
    }
}

export type TodayTotal = {
    /** Preformatted by the server ("2 hrs 14 mins"); shown as-is. */
    text: string;
    seconds: number;
};

/**
 * Today's total — and, because it is the cheapest call that proves the key is
 * good, also what the dialog's "Test" button runs.
 */
export async function fetchToday(credentials: Credentials): Promise<TodayTotal | SendFailure> {
    try {
        const response = await request(`${WAKATIME_API_URL}/users/current/statusbar/today`, {
            method: "GET",
            headers: headers(credentials),
        });
        if (!response.ok) {
            return failureFromStatus(response.status, await readError(response));
        }
        const payload = (await response.json()) as {
            data?: { grand_total?: { text?: string; digital?: string; total_seconds?: number } };
        };
        const total = payload.data?.grand_total;
        return {
            text: total?.text ?? total?.digital ?? "0 mins",
            seconds: typeof total?.total_seconds === "number" ? total.total_seconds : 0,
        };
    } catch (error) {
        return { ok: false, kind: "network", message: errorMessage(error) };
    }
}

export function errorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === "AbortError") {
        return "Request timed out";
    }
    return error instanceof Error ? error.message : String(error);
}
