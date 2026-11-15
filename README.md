# PaceMan Stats

https://paceman.gg/stats/

## Sentry metrics and logs

Server telemetry runs in production with `@sentry/nextjs` 10.71.0 or newer.
Install the updated lockfile with `npm ci --legacy-peer-deps`, then build and
restart the website normally. The flag accommodates the repository's existing
React/Twitch embed peer dependency constraint.
It summarizes API requests locally and sends at most five metric points every
15 minutes per Node process: request count, server-error count, throttled count,
mean duration and maximum duration. Empty intervals send nothing; zero error
and throttle counts are omitted. Metrics start appearing after the first
15-minute interval with traffic. They cover application API handlers, excluding
requests served entirely by nginx/CDN caches. Durations end when the handler
returns its response, rather than when a client finishes downloading it.

Only API server failures, successful requests taking at least two seconds,
Redis connection failures and MySQL pool pressure produce Sentry logs.
The final SDK filter caps these at **four logs per rolling hour per process**,
with a **15-minute cooldown** for the same message and operation. Messages use
fixed text, operation names and status codes; no request bodies, credentials,
SQL text or player identifiers are added. Console output is not forwarded.
Browser and edge custom logs/metrics are disabled; existing error capture and
trace sampling remain configured separately.

Set `SENTRY_TELEMETRY_ENABLED=false` on the website server and restart it to
disable these custom logs/metrics. Development also leaves them off. Aggregates
are in memory and recent counts can be lost on a restart; limits reset when a
process restarts and multiply across workers/replicas. These controls limit this
instrumentation's volume, rather than guaranteeing an organization-wide quota.

Run `node --import tsx tests/sentry-telemetry.ts` for local budget, aggregation,
API behavior and real SDK transport checks. The test uses a capturing transport
and sends no events to Sentry.
