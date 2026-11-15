# Local performance verification

Run these checks inside `pacestats-dev`, against its local MySQL and Redis.
Do not point the tools at production. Browser scripts reject non-local URLs.
Use a production Next build for timing; development compilation and HMR
distort page latency, CPU, and memory results.

## OBS snapshot delivery

The OBS regression fixtures run inside the local Docker container. They use
mock SQL for changing data, private HTTP/WS listeners and isolated Pub/Sub
channels; they do not insert or delete stored runs:

```sh
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/obs-snapshot-data.ts && node --import tsx tests/obs-snapshot-route.ts && node --import tsx tests/obs-snapshot-shared-budget.ts && node --import tsx tests/obs-mutation-notifications.ts && node --import tsx tests/overlay-initial-data.ts && node --import tsx tests/session-subscription.ts'
docker exec pacestats-dev sh -c 'cd /app && node tests/websocket-snapshots.mjs && node tests/websocket-snapshot-delivery.mjs && node tests/overlay-client-delivery.mjs'
```

For production parity and timing, build baseline and candidate copies with
`NEXT_PUBLIC_WS_ENDPOINT` pointing to their separate WS services (8091/8092 in
this example). Start their Next.js builds on 5095/5096 and both WS services on
a private `WS_REDIS_CHANNEL=pacestats:obs-perf-local`. The candidate broker's
`WS_SNAPSHOT_ENDPOINT` must point directly to
`http://127.0.0.1:5096/stats/api/obsSnapshot/`, with the same private `WS_TOKEN`
as Next.js. Allow both local web origins through `WS_ALLOWED_ORIGINS`.
Use the same database, dependencies and local upstream fixture for both
revisions. Run browser checks separately from timing, with cron paused:

```sh
docker exec pacestats-dev sh -c 'cd /app && PERF_BASELINE_URL=http://127.0.0.1:5095 PERF_BASE_URL=http://127.0.0.1:5096 node tests/overlay-production-parity.mjs'
docker exec pacestats-dev sh -c 'cd /app && PERF_BASELINE_URL=http://127.0.0.1:5095/stats/ PERF_BASE_URL=http://127.0.0.1:5096/stats/ PERF_WS_CHANNEL=pacestats:obs-perf-local node scripts/perf-overlay-updates.mjs'
```

The delivery probe alternates three fresh contexts per revision, with three
notifications each, 300 ms HTTP latency and 4× CPU slowdown. It explicitly
relays real WS frames with 150 ms downlink delay; HTTP CDP throttling alone
does not establish socket-frame latency. Initial visible values, subscription
readiness and subsequent data arrival are distinct measurements. The dataset
is static: changed-value DOM rendering is covered by the React fixture, not
the notification timing result. Restore cron and stop the isolated servers
afterward. See `ops/performance/2026-11-15-obs-live.md` for results and limits.

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

## Fourth-round checks

This round compares baseline `b726785` with the fourth-round source. Keep
evidence under `/app/test-artifacts/performance/round4/`. The isolated production
servers use ports **5091** (baseline), **5092** (candidate), and **5093** (candidate
with empty Redis database 15). Build the snapshots with the same webpack command
and dependencies described above; the baseline source is
`/tmp/pacestats-round4-baseline` and the candidate snapshot is
`/tmp/pacestats-round4-final`.

Both measured revisions must preload the same local upstream fixture. It returns
an empty live-run snapshot and immediate unavailable responses for other external
fetches, while retaining localhost requests. This removes third-party timing from
server rendering as well as from the browser. Use this preload only for the
isolated Docker benchmark servers. For example, start each command in its own
Docker shell/process after its build has completed:

```sh
cd /tmp/pacestats-round4-baseline
node --import /app/tests/local-upstreams.mjs node_modules/next/dist/bin/next start -p 5091

cd /tmp/pacestats-round4-final
node --import /app/tests/local-upstreams.mjs node_modules/next/dist/bin/next start -p 5092

cd /tmp/pacestats-round4-final
REDIS_URL=redis://127.0.0.1:6379/15 node --import /app/tests/local-upstreams.mjs node_modules/next/dist/bin/next start -p 5093
```

Check Redis 15 is empty before the cold server starts. Do not clear the primary
Redis database. Backend fixtures below use Redis 14 and must run sequentially;
they check their fixture keys are absent and remove only keys they created.
`combined-replacements.mjs` uses namespaced keys in Redis 13, checks its starting
`DBSIZE`, and verifies the same size after deleting its owned keys. Do not run
these fixtures, publishing jobs, source profilers or builds during browser timing.
Pause cron and restart it after all comparisons have finished.

All following commands run **inside Docker**, from `/app`. From the host, open a
shell with `docker exec -it pacestats-dev bash`. The backend checks cover bounded
Redis projections/recovery, session overflow and query work, short-page counts,
cache keys/hits, compact identity failures, name projections and API limits:

```sh
node --expose-gc --import tsx tests/aa-board-prefixes.ts
node --import tsx tests/leaderboard-recovery-batches.ts
node --import tsx tests/session-overflow-probes.ts
node --import tsx tests/split-window-projection.ts
PERF_BASELINE_ORIGIN=http://127.0.0.1:5091 node --import tsx tests/legacy-session-query-work.ts
node --import tsx tests/short-page-counts.ts
node --expose-gc --import tsx tests/cache-hit-path.ts
node --import tsx tests/compact-user-failure-coalescing.ts
node --expose-gc --import tsx tests/player-names-projection.ts
node --import tsx tests/live-lookup-api-bounds.ts
```

Frontend fixtures exercise compact table models, lazy exact timestamps, shared
search indexes, color updates, abandoned AA requests and unrelated OBS state:

```sh
node --import tsx tests/tracker-presentation.ts
node --import tsx tests/recent-run-presentation.ts
node tests/lazy-timestamps.mjs
node --import tsx tests/search-index.ts
node --import tsx tests/frame-value.ts
node tests/frontend-workloads.mjs
PERF_SOURCE_ROOT=/tmp/pacestats-round4-baseline node tests/lazy-timestamps.mjs
PERF_SOURCE_ROOT=/tmp/pacestats-round4-baseline node tests/frontend-workloads.mjs
```

The React workload uses development profiling and local stubs; its render counts
and payload-size fixtures are structural checks, not production page timings.
Check the actual production render and navigation separately. Profile parity
compares table text, cell order, links, images and live indicators for pace,
tracker and AA pages, then exercises AA range changes and history pagination:

```sh
PERF_BASELINE_URL=http://127.0.0.1:5091/stats/ PERF_BASE_URL=http://127.0.0.1:5092/stats/ node tests/profile-presentation-parity.mjs
PERF_BASELINE_URL=http://127.0.0.1:5091/stats/ PERF_BASE_URL=http://127.0.0.1:5092/stats/ node tests/aa-leaderboard-parity.mjs
PERF_BASE_URL=http://127.0.0.1:5092/stats/ node tests/frontend-navigation.mjs
```

Producer checks cover board byte parity, hash cursor/error handling, metadata
validation, bounded Redis batches, exact combined summaries and streamed player
stats. The UUID-order test injects a read-only MySQL CTE with case-insensitive,
space-padding collation; it verifies that distinct case/trailing-space strings
retain every bucket across SQL batch boundaries. It creates no SQL fixtures:

```sh
node --import tsx tests/cache-top-boards.mjs
node --import tsx tests/hash-pages.mjs
node --import tsx tests/full-state-pages.mjs
node --import tsx tests/combined-candidates.mjs
node --import tsx tests/combined-bucket.mjs
PERF_LOCAL_DOCKER=1 node --import tsx tests/combined-replacements.mjs
PERF_LOCAL_DOCKER=1 node --import tsx tests/combined-rebuild-order.mjs
node --import tsx tests/player-stats-staging.mjs
node --import tsx tests/cache-producer-metadata.mjs
node --import tsx scripts/verify-cache-stream.ts
```

The combined producer profiler uses real SQL and mocked Redis, so it never
publishes. Run it separately from all other measurements. For the imported dump,
bucket 691 and explicit `PERF_CHECKED_FROM=1790812800` (2026-10-01 00:00:00 UTC)
produce the retained 112,919-to-1,218 SQL-result-row comparison. The helper's
default watermark, `1794278400`, is a different overlap and does not reproduce
those counts:

```sh
PERF_LOCAL_DOCKER=1 PERF_SOURCE_FILE=/tmp/pacestats-round4-baseline/scripts/combined-summaries.ts PERF_OUTPUT=/app/test-artifacts/performance/round4/bucket-before.json node --import tsx scripts/perf-combined-producers.mjs closeBucket
PERF_LOCAL_DOCKER=1 PERF_OUTPUT=/app/test-artifacts/performance/round4/bucket-after.json node --import tsx scripts/perf-combined-producers.mjs closeBucket
PERF_LOCAL_DOCKER=1 PERF_CHECKED_FROM=1790812800 PERF_SOURCE_FILE=/tmp/pacestats-round4-baseline/scripts/combined-summaries.ts PERF_OUTPUT=/app/test-artifacts/performance/round4/stale-before.json node --import tsx scripts/perf-combined-producers.mjs findStalePlayers
PERF_LOCAL_DOCKER=1 PERF_CHECKED_FROM=1790812800 PERF_OUTPUT=/app/test-artifacts/performance/round4/stale-after.json node --import tsx scripts/perf-combined-producers.mjs findStalePlayers
PERF_LOCAL_DOCKER=1 PERF_SOURCE_FILE=/tmp/pacestats-round4-baseline/scripts/combined-summaries.ts PERF_OUTPUT=/app/test-artifacts/performance/round4/rebuild-before.json node --import tsx scripts/perf-combined-producers.mjs rebuildPlayers
PERF_LOCAL_DOCKER=1 PERF_OUTPUT=/app/test-artifacts/performance/round4/rebuild-after.json node --import tsx scripts/perf-combined-producers.mjs rebuildPlayers
```

`PERF_BUCKET` selects a different closed bucket. The rebuild probe selects the
50 busiest players and can read many rows. Its `fieldHash` canonicalizes unordered
Redis hash fields while preserving each field's serialized bytes; compare that
digest after ordering changes. The separate `hash` also captures producer argument
order, which is not a Redis hash ordering guarantee. Explain-plan artifacts
`bucket-explain.json` and `rebuild-explain.json` record the UUID sort tradeoff;
bounded one-player accumulation does not establish a latency improvement. The
optional `PERF_BENCHMARK=1` modes in the board/hash/player-stats fixtures are
synthetic scaling workloads, not complete site-job measurements.

WebSocket fixtures verify coalescing deadlines/reload priority, weighted dispatch
yields, heartbeat bounds, reconnect cleanup and actual local delivery. The real
server fixture starts a private port and Redis Pub/Sub channel and shuts them down:

```sh
node tests/websocket-coalescing.mjs
node tests/websocket-heartbeats.mjs
node tests/websocket-delivery.mjs
PERF_BENCHMARK=1 PERF_VARIANT=legacy node --expose-gc tests/websocket-coalescing.mjs
PERF_BENCHMARK=1 PERF_VARIANT=current node --expose-gc tests/websocket-coalescing.mjs
```

After any coordinated local publishing verification, restart both measured Next
processes against the same generated data. Keep the upstream preload on both.
Collect three complete browser samples per revision, alternating order; these
commands retain the harness's 300ms network latency and 4x CPU slowdown:

```sh
for sample in 1 2 3; do
    if [ "$sample" = 2 ]; then variants="final baseline"; else variants="baseline final"; fi
    for variant in $variants; do
        if [ "$variant" = baseline ]; then port=5091; else port=5092; fi
        PERF_BASE_URL=http://127.0.0.1:$port/stats/ PERF_OUTPUT=/app/test-artifacts/performance/round4/$variant-browser-$sample.json node scripts/perf-browser.mjs
    done
done
PERF_SAMPLES_DIR=/app/test-artifacts/performance/round4 node scripts/perf-summary.mjs
PERF_BASELINE_URL=http://127.0.0.1:5091/stats/ PERF_BASE_URL=http://127.0.0.1:5092/stats/ PERF_OUTPUT=/app/test-artifacts/performance/round4/aa-browser.json node scripts/perf-aa.mjs
PERF_BASELINE_URL=http://127.0.0.1:5091/stats/ PERF_BASE_URL=http://127.0.0.1:5092/stats/ PERF_OUTPUT=/app/test-artifacts/performance/round4/profile-pages.json node scripts/perf-profile-pages.mjs
PERF_BASE_URL=http://127.0.0.1:5092/stats/ PERF_OUTPUT=/app/test-artifacts/performance/round4/warm-http.json node scripts/perf-http.mjs
PERF_BASE_URL=http://127.0.0.1:5093/stats/ PERF_EMPTY_REDIS=1 PERF_OUTPUT=/app/test-artifacts/performance/round4/cold-http.json node scripts/perf-http.mjs
```

`perf-profile-pages.mjs` separately compares cold-browser AA profile, tracker and
OBS setup loads. Each route gets three fresh browser contexts per revision,
alternating order, with 300ms network latency and 4x CPU slowdown. Readiness
requires hydrated tables or OBS search/URL controls. Its results include page
bytes, long tasks and LCP, with final-sample screenshots; this does not clear
server, Redis or MySQL caches.

Publishing changes primary local Redis and must use the normal job wrapper and
leases in a separate coordinated phase. The corrected round-four lifetime
publication evidence is `stats-publish-parity.json` (8,422 generated values).
`producer-publish-parity.json` supplies populated history/combined checks; its
zero-key lifetime scan is not lifetime parity evidence. Neither publication
artifact replaces the read-only SQL fixture checks above. Finish with Docker
`npm run typecheck` and `npm run lint`, and preserve all failure/cleanup evidence.
