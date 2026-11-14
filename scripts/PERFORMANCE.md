# Local performance verification

Run these checks inside `pacestats-dev`, against its local MySQL and Redis.
Do not point the tools at production. Browser scripts reject non-local URLs.
Use a production Next build for timing; development compilation and HMR
distort page latency, CPU, and memory results.

## Browser setup

The browser tooling is deliberately separate from application dependencies:

```sh
docker exec pacestats-dev sh -c 'npm install --prefix /tmp/pacestats-perf playwright@1.65.1 && /tmp/pacestats-perf/node_modules/.bin/playwright install --with-deps chromium'
```

For isolated comparisons, export each revision into a different directory
inside Docker, link `/app/node_modules`, and build with
`npm run build -- --webpack`. Both revisions must use the same build tool,
dependencies, database, and environment. Webpack accepts the external
node_modules link; Turbopack requires its filesystem root to include it.
Start those builds on separate unused local ports with
`node node_modules/next/dist/bin/next start -p PORT`.

Pause the local cron service during measurements, then restart it afterward.
Never delete the normal Redis database for a cold-cache benchmark. Use an
unused Redis database and a separate Next process whose `REDIS_URL` selects
that database; check that `DBSIZE` is zero before using it. The investigation
used database 15 for empty-cache HTTP checks and 14 for owned test fixtures.

## Commands

The examples assume a production server on port 5052 and an otherwise
identical process using empty Redis database 15 on port 5053.

```sh
docker exec pacestats-dev sh -c 'cd /app && PERF_BASE_URL=http://127.0.0.1:5052/stats/ PERF_OUTPUT=/app/test-artifacts/performance/browser.json node scripts/perf-browser.mjs'
docker exec pacestats-dev sh -c 'cd /app && PERF_BASE_URL=http://127.0.0.1:5052/stats/ node tests/frontend-navigation.mjs'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/frontend-clock.ts'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/backend-performance.ts'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/cold-cache.ts'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/api-performance-limits.ts'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/cache-budget.ts'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx scripts/verify-cache-stream.ts'
docker exec pacestats-dev sh -c 'cd /app && PERF_BASE_URL=http://127.0.0.1:5052/stats/ PERF_OUTPUT=/app/test-artifacts/performance/warm-http.json node scripts/perf-http.mjs'
docker exec pacestats-dev sh -c 'cd /app && PERF_BASE_URL=http://127.0.0.1:5053/stats/ PERF_EMPTY_REDIS=1 PERF_OUTPUT=/app/test-artifacts/performance/cold-http.json node scripts/perf-http.mjs'
docker exec pacestats-dev sh -c 'cd /app && PERF_LOCAL_DOCKER=1 node --expose-gc --import tsx scripts/perf-data.mjs'
docker exec pacestats-dev sh -c 'cd /app && node scripts/perf-summary.mjs'
```

`perf-data.mjs` reads helpers from its current directory (or
`PERF_SOURCE_ROOT`); use a fresh process for each cold-process sample. It
does not clear MySQL's buffer pool or Redis. Its result hashes canonicalize
object key order while preserving array order and values; the correctness
tests also compare values separately.

The fixtures default to `NoFearr1337`, UUID
`e4cd494a-4e0a-423b-9988-618b86858c96`, the imported dump's busiest player
(21,593 runs). `PERF_PLAYER`, `PERF_UUID`, and `PERF_TEST_UUID` override the
relevant tools. An old dump can have an empty 24-hour window; that is valid.

## Measurement definitions

- Browser CDP network latency is **300 ms**, with 10 Mbps download and 5 Mbps
  upload. The timing harness also applies a **4x CPU slowdown**, configurable
  using `PERF_CPU_RATE`. This simulates constrained execution, not a specific
  physical phone.
- Each browser run starts with a new context. HTTP caching is disabled by
  Playwright request routing; Next's in-memory navigation reuse still works.
  Third-party avatar images, including requests through Next's image proxy,
  are stubbed, and external browser APIs/telemetry are blocked, keeping
  tests local and repeatable.
- Page readiness requires content and hydrated controls. Range readiness
  waits for the committed URL and pending state to finish. No arbitrary
  sleep is added to reported page readiness. Run details report content
  visibility as `readyMs` and hydration separately as `interactiveMs`;
  subsequent navigation waits for hydration to avoid carrying unfinished
  page startup into another page's timing. Tracker history is opened through
  the profile's Debug link, matching the actual client navigation flow.
- `decodedBytes` and `scriptBytes` are uncompressed completed same-origin
  resource bytes during the measured action. The local Next server runs
  without the production nginx compression/cache layer. These figures are
  not production transfer sizes. Late background resources can appear in
  the following action.
- Long tasks exceed 50 ms. Browser heap is sampled after each action and is
  affected by garbage collection. Data-helper CPU is process CPU time;
  reported RSS peaks are samples, not an allocator-level bound.
- Repeat browser runs and compare medians. Keep heavy cache rebuilds and
  other browser sessions separate from timing runs. Save at least three
  complete samples as `baseline-browser-1.json` through
  `baseline-browser-3.json` and `final-browser-1.json` through
  `final-browser-3.json`; `perf-summary.mjs` validates and summarizes them.

Full cache jobs write local Redis and can take minutes with default pacing.
Use the existing job wrapper/lease; avoid overlapping full jobs. The source
stream verifier is read-only and checks batch boundaries, backpressure,
parameter binding, and consumer failure cleanup without a cache rebuild.

## Cold-cache behavior

An empty process cache with generated Redis data should render normally.
Missing compact leaderboard documents are reconstructed from generated
root documents using bounded prefixes. A completely absent leaderboard
dataset needs the scheduled cache producer: pages offer Retry, while APIs
return `503`, `CACHE_NOT_READY`, `Retry-After`, and `no-store`. Requests do
not synchronously rebuild every player's historical stats.

Profiles recover missing generated stats through a player-scoped database
read, including reset statistics, identity, and Twitch accounts. Unavailable
global rankings use `-1` and are omitted from the UI.
The SQL history grid returns only its requested page rather than decoding
an entire lifetime history in application memory.

The production build inlines initial CSS through Next's `inlineCss` option.
This removes the initial blocking stylesheet round trip. CSS is also included
in the initial Flight serialization, adding about 99 KB of raw HTML (about
10 KB with Brotli); the normal external CSS was about 51 KB raw. RSC navigation
payloads retain stylesheet references and do not acquire the CSS body. Recheck
this tradeoff after a Next upgrade because the option is experimental.

## Second-round checks

The 15 November investigation compares `edf658e` with the second-round build.
Use a separate `PERF_OUTPUT` directory such as
`/app/test-artifacts/performance/round2/` and set `PERF_SAMPLES_DIR` to it when
running `perf-summary.mjs`. Both revisions must read the same Redis generation;
restart their test processes after publishing verification and before the
paired comparison. Do not publish while capturing browser parity or timing.

Additional Docker commands, from `/app` with `PERF_BASE_URL` set to the desired
local production server:

```sh
node --import tsx tests/redis-read-coalescing.ts
node --import tsx tests/prepared-statement-budget.ts
node --expose-gc --import tsx tests/aa-cold-statistics.ts
node --import tsx tests/leaderboard-presentation.ts
node --import tsx tests/cache-producer-metadata.mjs
node --import tsx tests/deferred-prefetch.ts
node tests/run-history-navigation.mjs
PERF_BASELINE_URL=http://127.0.0.1:5071/stats/ node tests/leaderboard-navigation.mjs
node scripts/perf-interactions.mjs
PERF_LOCAL_DOCKER=1 node --expose-gc --import tsx scripts/perf-producers.mjs pace
PERF_LOCAL_DOCKER=1 node --expose-gc --import tsx scripts/perf-producers.mjs nph
```

The producer profiler replaces publication with hashes; it does not write Redis.
It dynamically loads a disposable copy of the private TypeScript producer
helpers, so its `.mjs` entry point also requires `--import tsx`. The first-open
filter probe reports the first usable preset button, resource bytes, long
tasks and CDP heap usage. Its screenshot waits for the collapse animation
after the measured interaction has finished.

## Third-round checks

The next 20 local commits compare `5857b6a` with the third-round source.
Save samples under `/app/test-artifacts/performance/round3/`. Production servers
used ports 5081 (baseline), 5082 (candidate), and 5083 (candidate with empty
Redis 15). Repeat the main browser benchmark three times per revision, alternating
their order. Run the AA probe separately while no other browser or producer is active.

```sh
node --import tsx tests/identity-index.ts
node --import tsx tests/search-top-results.ts
PERF_COMPARE_SOURCE_ROOT=/tmp/pacestats-round3-baseline node --expose-gc --import tsx tests/session-query-work.ts
node --import tsx tests/session-window-boundaries.ts
PERF_COMPARE_SOURCE_ROOT=/tmp/pacestats-round3-baseline node --import tsx tests/latest-completion-query.ts
PERF_COMPARE_SOURCE_ROOT=/tmp/pacestats-round3-baseline node --expose-gc --import tsx tests/export-row-processing.ts
node --import tsx tests/player-info-cache.ts
node --import tsx tests/font-catalog.ts
node --import tsx tests/session-subscription.ts
node --import tsx tests/time-formatting.ts --bench
node --import tsx tests/run-history-splice.mjs
node --import tsx tests/run-history-layout.mjs
node --import tsx tests/combined-summary-small.mjs
node tests/run-store-rendering.mjs
PERF_SOURCE_ROOT=/tmp/pacestats-round3-baseline node tests/run-store-rendering.mjs
PERF_BASE_URL=http://127.0.0.1:5082/stats/ node tests/sample-visibility.mjs
PERF_BASE_URL=http://127.0.0.1:5082/stats/ node tests/search-dismissal.mjs
PERF_BASELINE_URL=http://127.0.0.1:5081/stats/ PERF_BASE_URL=http://127.0.0.1:5082/stats/ node tests/aa-leaderboard-parity.mjs
PERF_BASELINE_URL=http://127.0.0.1:5081/stats/ PERF_BASE_URL=http://127.0.0.1:5082/stats/ node scripts/perf-aa.mjs
PERF_LOCAL_DOCKER=1 node --expose-gc --import tsx scripts/perf-periods.mjs pace
PERF_LOCAL_DOCKER=1 node --expose-gc --import tsx scripts/perf-periods.mjs nph
PERF_SERVER_PID=<isolated-Next-PID> PERF_BASE_URL=http://127.0.0.1:5083/stats/ node scripts/perf-api-burst.mjs
```

All commands above run **inside Docker**, from `/app`. `perf-periods.mjs` uses
`PERF_SOURCE_FILE` for the older producer and `PERF_AS_OF` to hold the window
constant; it never publishes. Check both a current window and an older timestamp
with populated 1d/7d/30d data. The run-store integration test bundles the actual
components in development React to count commits, stubbing polling, routing,
fonts and Twitch; its counts are not production CPU measurements. Full navigation
tests exercise the real production router separately.

The burst probe makes 18 concurrent read-only requests and two recovery requests.
Use a fresh isolated Next process: module loading is part of the result. It reads
that process's Linux CPU ticks and samples RSS every 10ms. It checks useful 200
responses, retryable 429 overload responses and subsequent recovery. It does not
claim a CPU utilization ceiling or measure total Docker/database memory. Keep it
separate from timed browser runs.
