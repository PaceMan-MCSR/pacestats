# PaceMan Stats

https://paceman.gg/stats/

## Startup cache warming

Every Node web server process starts warming the website's shared data cache
from Next.js instrumentation, in development and production. It runs once per
process in the background, so the server can accept requests while it warms.
Requests for the same data share the existing in-flight reads.

Warming covers users/search identities and customization, main and AA boards
for 1, 7, 30 and all-time periods, default public leaderboard/fastest branches,
and PBs. It also selects up to 12 players across those boards and warms their
profiles, recent runs and run details, first history pages, and default session,
NPH and single-player combined API variants. Arbitrary player combinations,
custom filters and search queries continue to populate on demand. Live OBS
snapshots keep their existing fresh-read behavior.

Two jobs run at a time, using the same cache keys, TTLs and memory limits as
normal requests. After 60 seconds no further warm-up reads are started; active
reads keep their normal database/Redis timeouts. Failures leave the server
running and a `[cache-warmup]` console summary reports successful, failed and
skipped reads. Cache producer jobs still maintain the Redis aggregates.

Optional environment settings (restart the web server after changing them):

- `DATA_CACHE_WARMUP_ENABLED=false` disables startup warming.
- `DATA_CACHE_WARMUP_PLAYERS=12` controls the player sample (0–50).
- `DATA_CACHE_WARMUP_MAX_MS=60000` sets the scheduling budget (1–300000 ms).

Run `node --import tsx tests/startup-cache-warmup.ts` for isolated startup,
coverage, concurrency and failure tests without database or network access.

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
