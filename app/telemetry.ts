import type {init} from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;
type Log = Parameters<NonNullable<SentryOptions["beforeSendLog"]>>[0];
type Metric = Parameters<NonNullable<SentryOptions["beforeSendMetric"]>>[0];

export const TELEMETRY_INTERVAL_MS = 15 * 60_000;
export const TELEMETRY_SOURCE = "pacestats";
export const API_METRICS = {
    requests: "pacestats.api.requests",
    errors: "pacestats.api.server_errors",
    throttled: "pacestats.api.throttled",
    meanDuration: "pacestats.api.duration_mean",
    maxDuration: "pacestats.api.duration_max",
} as const;

const metricNames = new Set<string>(Object.values(API_METRICS));

/** A final SDK-side budget, including any future call sites. Limits are per process. */
export const createTelemetryFilters = (now: () => number = () => performance.now()) => {
    const logs: Array<{at: number; key: string}> = [];
    const metricTimes = new Map<string, number>();
    return {
        beforeSendLog(log: Log): Log | null {
            if (log.attributes?.source !== TELEMETRY_SOURCE || !["warn", "error"].includes(log.level)) return null;
            const at = now();
            while (logs.length && at - logs[0].at >= 60 * 60_000) logs.shift();
            const key = `${log.message}:${log.attributes?.operation ?? ""}`;
            if (logs.length >= 4 || logs.some(entry => entry.key === key && at - entry.at < TELEMETRY_INTERVAL_MS)) return null;
            logs.push({at, key});
            return log;
        },
        beforeSendMetric(metric: Metric): Metric | null {
            if (metric.attributes?.source !== TELEMETRY_SOURCE || !metricNames.has(metric.name) ||
                !Number.isFinite(metric.value) || metric.value < 0) return null;
            const at = now();
            const previous = metricTimes.get(metric.name);
            if (previous !== undefined && at - previous < TELEMETRY_INTERVAL_MS) return null;
            metricTimes.set(metric.name, at);
            return metric;
        },
    };
};

/** Aggregate locally; Sentry receives summaries rather than a metric per request. */
export class ApiTelemetrySummary {
    private requests = 0;
    private errors = 0;
    private throttled = 0;
    private duration = 0;
    private maxDuration = 0;

    record(status: number, durationMs: number) {
        this.requests++;
        if (status >= 500) this.errors++;
        if (status === 429) this.throttled++;
        const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
        this.duration += duration;
        this.maxDuration = Math.max(this.maxDuration, duration);
    }

    drain(): {requests: number; errors: number; throttled: number; meanDuration: number; maxDuration: number} | null {
        if (!this.requests) return null;
        const summary = {requests: this.requests, errors: this.errors, throttled: this.throttled,
            meanDuration: this.duration / this.requests, maxDuration: this.maxDuration};
        this.requests = this.errors = this.throttled = this.duration = this.maxDuration = 0;
        return summary;
    }
}
