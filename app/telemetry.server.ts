import {getClient, logger, metrics} from "@sentry/nextjs";
import {API_METRICS, ApiTelemetrySummary, TELEMETRY_INTERVAL_MS, TELEMETRY_SOURCE} from "./telemetry";

const runtime = globalThis as typeof globalThis & {
    __paceStatsTelemetry?: {summary: ApiTelemetrySummary; timer?: ReturnType<typeof setTimeout>};
};

const enabled = () => {
    if (process.env.NODE_ENV !== "production" || process.env.SENTRY_TELEMETRY_ENABLED === "false") return false;
    const client = getClient();
    return Boolean(client && client.getOptions().enabled !== false);
};

const attributes = {source: TELEMETRY_SOURCE};

const flushSummary = (summary: ApiTelemetrySummary) => {
    const values = summary.drain();
    if (!values || !enabled()) return;
    metrics.count(API_METRICS.requests, values.requests, {attributes});
    if (values.errors) metrics.count(API_METRICS.errors, values.errors, {attributes});
    if (values.throttled) metrics.count(API_METRICS.throttled, values.throttled, {attributes});
    metrics.gauge(API_METRICS.meanDuration, values.meanDuration, {unit: "millisecond", attributes});
    metrics.gauge(API_METRICS.maxDuration, values.maxDuration, {unit: "millisecond", attributes});
};

const getSummary = () => {
    if (!runtime.__paceStatsTelemetry) {
        const summary = new ApiTelemetrySummary();
        const state = {summary, timer: undefined as ReturnType<typeof setTimeout> | undefined};
        const schedule = () => {
            state.timer = setTimeout(() => {
                try {flushSummary(summary);} catch { /* Telemetry must not affect request handling. */ }
                // Start the next interval after sending, so timer jitter cannot trip the SDK budget.
                schedule();
            }, TELEMETRY_INTERVAL_MS);
            state.timer.unref();
        };
        schedule();
        runtime.__paceStatsTelemetry = state;
    }
    return runtime.__paceStatsTelemetry.summary;
};

type Issue = "api.failure" | "api.slow" | "redis.unavailable" | "database.pressure";
const issues = {
    "api.failure": ["error", "API request failed"],
    "api.slow": ["warn", "API request exceeded two seconds"],
    "redis.unavailable": ["error", "Redis connection unavailable"],
    "database.pressure": ["warn", "Database connection pool under pressure"],
} as const;

/** Fixed messages and bounded attributes; the SDK filter handles deduplication and budgets. */
export const reportTelemetryIssue = (issue: Issue, operation: string, status?: number) => {
    try {
        if (!enabled()) return;
        const [level, message] = issues[issue];
        logger[level](message, {source: TELEMETRY_SOURCE, operation, ...(status === undefined ? {} : {status})});
    } catch { /* A reporting failure must never break the application. */ }
};

export const observeApiRequest = <Args extends unknown[]>(
    operation: string, handler: (...args: Args) => Promise<Response>
) => async (...args: Args): Promise<Response> => {
    if (!enabled()) return handler(...args);
    const started = performance.now();
    let status = 500;
    try {
        const response = await handler(...args);
        status = response.status;
        return response;
    } finally {
        try {
            const duration = performance.now() - started;
            getSummary().record(status, duration);
            if (status >= 500) reportTelemetryIssue("api.failure", operation, status);
            else if (status >= 200 && status < 300 && duration >= 2_000) reportTelemetryIssue("api.slow", operation, status);
        } catch { /* Preserve the response or original exception if telemetry fails. */ }
    }
};
