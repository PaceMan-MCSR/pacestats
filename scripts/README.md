# Cache producers

The cache jobs keep the legacy Redis keys consumed by the application while
publishing generation and health metadata for operations.

## Commands

- `npm run cache:refresh` builds 1, 7, and 30-day pace, AA, player, and NPH caches.
- `npm run cache:refresh:full` builds the `9999day`/all-time caches. After the first run it recomputes only
  players whose rows changed (see below); `npm run cache:refresh:full -- --rebuild` forces a full rescan.
- `npm run cache:runs` incrementally refreshes histories changed since the last successful watermark.
- `npm run cache:runs:full` streams histories in UUID/id order, staging and releasing one player at a time, and removes stale history keys.
- `npm run cache:profile` reports cache metadata, Redis memory/slowlog data, MySQL plans, and page timings.
- `npm run cache:benchmark:incremental` marks the busiest player dirty and times its cache-only history rebuild.
- `npm run ws:start` starts the WebSocket invalidation service.

For read-only producer profiling inside Docker, run:

```sh
docker exec -e PERF_LOCAL_DOCKER=1 pacestats-dev sh -c 'cd /app && node --import tsx scripts/perf-producers.mjs pace'
docker exec -e PERF_LOCAL_DOCKER=1 pacestats-dev sh -c 'cd /app && node --import tsx scripts/perf-producers.mjs nph'
docker exec -e PERF_LOCAL_DOCKER=1 -e RECENT_PACING_DELAY_MS=0 pacestats-dev sh -c 'cd /app && node --import tsx scripts/perf-producers.mjs histories'
docker exec pacestats-dev sh -c 'cd /app && node --import tsx tests/cache-producer-metadata.mjs'
```

The profiler reads actual MySQL rows and hashes producer output in place of
Redis writes. It records process CPU, peak RSS, garbage collections and result
hashes under `test-artifacts/performance/round2/`; `PERF_OUTPUT` overrides the
destination. Use `PERF_SOURCE_FILE` to compare a frozen producer source and a
fresh process per sample. The temporary module exposes private helpers after
removing the job entry point, and is removed after profiling. Source scans
still load the local database, so keep them separate from browser timing runs.

Run the normal aggregate job before the first full aggregate job because the
full job uses the existing `users` list to enumerate player-stat keys.

## Redis contracts

Existing reader keys are unchanged:

- `leaderboards:{days}day`, `topLeaderboards:{days}day`, and `fastestLeaderboards:{days}day`
- `playerStats:{uuid}:{days}day` and `nph:{uuid}:{days}day`
- `users` and `users:twitch_details:{uuid}`
- `combinedSplits:{uuid}` (new; see below)

Run histories moved from one string per player (`playerRunsOptimized:{uuid}`)
to two (see `app/runHistory.ts`):

- `playerRuns:head:{uuid}`: a header line `#2,<base version>,<base max id>` and
  the newest runs, one CSV line each, newest first;
- `playerRuns:base:{uuid}`: a header line `#2,<base version>` and every older
  run. Players with at most 128 runs have no base (version `-`).

Head lines followed by base lines are the old single string. New and updated
runs are spliced into the head, so the per-minute job reads and writes only that
key; the base is rewritten when one of its own runs changes, when the head passes
512 runs (the newest 128 stay in the head), and by complete rebuilds. A base and
its head are always renamed in the same guarded script. Readers fetch the head,
reuse the decoded base while its version is unchanged, fall back to a leftover
`playerRunsOptimized:{uuid}` and then to MySQL. `cache:recent:state` records
`layout`; the first `cache:runs` after an upgrade sees another layout, rebuilds
every history (about 5 s on the dev dump) and deletes the old keys. Deploy the
site before the job: the older site code reads only the old keys and would fall
back to MySQL for every history once they are gone.

AA boards use `aa:leaderboards:{days}day` with the same root object shape as
the former SQL `getAALB` result. The `users` entries retain `id`, `nick`, and
`twitches` and may additionally contain `displayName`, `color`, and `bgColor`.

Aggregate job metadata is stored in `cache:metadata:normal`,
`cache:metadata:full`, and per-period hashes. Current generation IDs are at
`cache:generation:normal` and `cache:generation:full`. Run-history state and
its successful SQL watermark live in `cache:recent:state`. Identity refresh
metadata lives in `cache:identity:state`.

Writers first create `cache:staging:{generation}:...` keys with a cleanup TTL.
Dynamic per-player keys are renamed in bounded, lock-guarded Lua batches; each
period's small fixed board set is then renamed in one atomic guarded batch. This keeps
legacy readers compatible and makes the inconsistency window short, but the
legacy readers do not consume a generation pointer, so all per-player keys
cannot switch in one atomic operation. Metadata is advanced only after every
publish and stale-key cleanup succeeds.

`cache:digest:normal` and `cache:digest:full` hash each dynamic key the
aggregate job published to a SHA-1 of its JSON. A run stages only values whose
digest changed (or whose key is missing); the others keep their key and have
their TTL renewed in a lock-guarded Lua batch. Digests of keys about to be
overwritten are deleted before publishing and recorded after it, so a crash
can only cause a rewrite, never a skipped one. Deleting a digest hash forces
a full rewrite on the next run.

`cache:aggregate:full:state` holds the all-time job's per-player summaries (one
hash field per UUID plus `__meta` with the watermark). A run recomputes only
players with pace/nethers rows inserted (`id` above the stored maximum),
updated (`lastUpdated`), inserted with a later `insertTime`, or deleted
(`cache_invalidation_outbox` scope `aggregate`, written by the triggers in
`ops/mysql/aggregate-delete-triggers.sql`), all compared with a
`CACHE_FULL_WATERMARK_OVERLAP_SECONDS` overlap. It rescans every row on the
first run, when the triggers are missing, when more than
`CACHE_FULL_INCREMENTAL_MAX_PLAYERS` players changed, and every
`CACHE_FULL_REBUILD_INTERVAL_SECONDS`. Changes that bypass those signals
(re-inserting a row with an old id and timestamps, or an UPDATE that sets
`lastUpdated` explicitly) appear at the next rescan.

`combinedSplits:{uuid}` and `cache:combined:state` serve `getCombinedStats` and
`getCombinedNethers` when no session gap applies (`hoursBetween >= hours`) and
the window is longer than about 30 days. `npm run cache:runs` maintains them
(see `scripts/combined-summaries.ts` and `app/combinedSummary.ts`): each hash
field is one 30-day bucket of `insertTime` (bucket = Unix time / 2,592,000)
holding, per split, the count, the total and the slowest half of the values;
field `m` is the largest row id covered. A bucket is summarised for every
player about six hours after it ends. A player whose rows in summarised buckets
changed (`lastUpdated`), or who had a run deleted (the dirty set, the `recent`
outbox entries, or the `aggregate` entries written by the delete triggers), gets
every bucket rebuilt on the next run. `cache:combined:state` records the format
version, the newest summarised bucket (`closedThrough`), the time from which
readers must re-check changes themselves (`checkedFrom`) and whether the delete
triggers exist. Readers add up the buckets inside the window, read the rest of
the window from MySQL, and fall back to MySQL for any player with newer changes,
for any bucket whose stored values cannot settle the slowest 2%, and entirely
when the state is missing, older than 15 minutes, in another format, or the
triggers are absent. Deleting `cache:combined:state` forces a rebuild (about
7 s on the dev dump) on the next run; `npm run cache:runs:full` also rebuilds.
The same caveat as the all-time job applies: a change that sets `lastUpdated`
explicitly to an old value is not seen until the next rebuild.

`cache:manifest:*` sets let successful jobs delete keys that disappeared from
the source. Each dynamic-key rename records the target in its manifest in the
same lock-guarded Lua operation, closing the publish-before-manifest crash gap.
Code paths which delete a pace row write a durable UUID/token to the SQL
`cache_invalidation_outbox` in the delete transaction and also add the UUID to
`cache:recent:dirty` as a fast wake-up. The incremental history job rebuilds
those UUIDs and acknowledges only tokens it actually processed; a full rebuild
is still the authoritative cleanup path.

## Locks and scheduling

The jobs use renewable Redis leases:

- `cache:lock:aggregate`
- `cache:lock:recent`

Keep the scheduler's own overlap policy set to `Forbid` as a second layer. A
typical deployment runs the normal aggregate job and incremental history job
frequently, with full jobs during a low-traffic window. The all-time aggregate
streams pace and NPH rows through their UUID indexes and releases each player's
derived split arrays once summarised. History rebuilds use the same bounded batches
and player-at-a-time processing. Combined-summary jobs stream source rows and
release each player's rebuilt buckets before continuing. Measure peak RSS
before choosing the production schedule; the largest single player and the
split arrays of a newly closed 30-day bucket still affect memory use.

## Configuration

All settings are optional unless noted:

| Variable | Default | Purpose |
| --- | ---: | --- |
| `REDIS_URL` | required | Cache and lock Redis endpoint |
| `CACHE_LOCK_TTL_MS` | 7200000 | Renewable aggregate lease |
| `RECENT_LOCK_TTL_MS` | 3600000 | Renewable history lease |
| `CACHE_REDIS_BATCH_SIZE` | 250 | Staging and cleanup batch size |
| `CACHE_REDIS_PUBLISH_BATCH_SIZE` | 250 | Dynamic rename transaction size; tune against Redis p99 latency |
| `CACHE_MANIFEST_BATCH_SIZE` | 1000 | Manifest set staging batch size |
| `CACHE_SQL_BATCH_SIZE` | 5000 | Stream batch/keyset page size for full aggregate source scans |
| `CACHE_FULL_REBUILD_INTERVAL_SECONDS` | 604800 | Longest time between full all-time rescans |
| `CACHE_FULL_INCREMENTAL_MAX_PLAYERS` | 2000 | Changed players above which the all-time job rescans everything |
| `CACHE_FULL_WATERMARK_OVERLAP_SECONDS` | 300 | Overlap for the all-time job's change detection |
| `CACHE_IDENTITY_FULL_REFRESH_SECONDS` | 86400 | Full identity reconciliation interval; intervening normal runs refresh only inserted, updated, or invalidated UUIDs |
| `CACHE_STAGING_TTL_SECONDS` | 21600 | Failed-generation cleanup |
| `CACHE_REDIS_COMMAND_TIMEOUT_MS` | 60000 | Per-command Redis timeout for cron jobs |
| `CACHE_PLAYER_TTL_SECONDS` | 1209600 | Normal dynamic-key TTL (14 days) |
| `CACHE_FULL_PLAYER_TTL_SECONDS` | 3888000 | Full dynamic-key TTL (45 days) |
| `RECENT_SQL_BATCH_SIZE` | 5000 | Stream batch/keyset query page size |
| `RECENT_FULL_SCAN_MODE` | uuid | `uuid` streams one player's history at a time; explicit `primary` retains all encoded histories |
| `RECENT_OUTBOX_BATCH_SIZE` | 500 | Durable invalidation read/acknowledgement batch size |
| `RECENT_REDIS_BATCH_SIZE` | 25 | History Redis batch size |
| `RECENT_PACING_DELAY_MS` | 10 | Pause between streamed SQL batches during history/combined rebuilds; 0 disables pacing |
| `RECENT_UUID_BATCH_SIZE` | 50 | Changed players fetched together per incremental SQL scan |
| `RECENT_INCREMENTAL_MAX_PLAYERS` | 1000 | Threshold that triggers a safe full rebuild |
| `RECENT_INCREMENTAL_MAX_ROWS` | 250000 | History rows allowed before incremental work falls back to a full rebuild |
| `RECENT_WATERMARK_OVERLAP_SECONDS` | 2 | Protection against timestamp precision races |
| `RECENT_CACHE_TTL_SECONDS` | 0 | Optional history-key TTL; if nonzero it must exceed the full-rebuild interval because unchanged keys renew only on a full rebuild |

The WebSocket server subscribes to `pacestats:run-updates` by default
(`WS_REDIS_CHANNEL` overrides it). Publishers send JSON
`{"uuid":"...","type":"refresh"}`; omitted `type` means `refresh`. The
authenticated legacy `/push/{uuid}/{token}` endpoint remains available during
migration. The service fails startup without `REDIS_URL` so a configuration
mistake cannot silently accept pull clients without delivering updates; set
`WS_ALLOW_LEGACY_WITHOUT_REDIS=true` only for an intentional legacy-only
deployment. Capacity/backpressure controls are `WS_MAX_CLIENTS`,
`WS_MAX_CLIENTS_PER_UUID`, `WS_MAX_BUFFERED_BYTES`, and `WS_COALESCE_MS`.
Local startup reads `.env.local`; set `DOTENV_CONFIG_PATH` to use another env file.
