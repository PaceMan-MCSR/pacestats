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
  Third-party avatar images are stubbed, and external browser APIs/telemetry
  are blocked, keeping tests local and repeatable.
- Page readiness requires content and hydrated controls. Range readiness
  waits for the committed URL and pending state to finish. No arbitrary
  sleep is added to reported page readiness.
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
