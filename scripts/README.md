# Cache producers

The cache jobs keep the legacy Redis keys consumed by the application while
publishing generation and health metadata for operations.

## Commands

- `npm run cache:refresh` builds 1, 7, and 30-day pace, AA, player, and NPH caches.
- `npm run cache:refresh:full` builds the `9999day`/all-time caches.
- `npm run cache:runs` incrementally refreshes histories changed since the last successful watermark.
- `npm run cache:runs:full` performs a primary-key history rebuild and removes stale history keys; UUID mode is the low-memory fallback.
- `npm run cache:profile` reports cache metadata, Redis memory/slowlog data, MySQL plans, and page timings.
- `npm run cache:benchmark:incremental` marks the busiest player dirty and times its cache-only history rebuild.
- `npm run ws:start` starts the WebSocket invalidation service.

Run the normal aggregate job before the first full aggregate job because the
full job uses the existing `users` list to enumerate player-stat keys.

## Redis contracts

Existing reader keys are unchanged:

- `leaderboards:{days}day`, `topLeaderboards:{days}day`, and `fastestLeaderboards:{days}day`
- `playerStats:{uuid}:{days}day` and `nph:{uuid}:{days}day`
- `users` and `users:twitch_details:{uuid}`
- `playerRunsOptimized:{uuid}`

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
still needs memory proportional to its largest source table/derived split set;
measure its peak RSS before choosing the production schedule.

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
| `CACHE_SQL_BATCH_SIZE` | 5000 | Keyset page size for full aggregate source scans |
| `CACHE_IDENTITY_FULL_REFRESH_SECONDS` | 86400 | Full identity reconciliation interval; intervening normal runs refresh only inserted, updated, or invalidated UUIDs |
| `CACHE_STAGING_TTL_SECONDS` | 21600 | Failed-generation cleanup |
| `CACHE_REDIS_COMMAND_TIMEOUT_MS` | 60000 | Per-command Redis timeout for cron jobs |
| `CACHE_PLAYER_TTL_SECONDS` | 1209600 | Normal dynamic-key TTL (14 days) |
| `CACHE_FULL_PLAYER_TTL_SECONDS` | 3888000 | Full dynamic-key TTL (45 days) |
| `RECENT_SQL_BATCH_SIZE` | 5000 | Keyset query page size |
| `RECENT_FULL_SCAN_MODE` | primary | `primary` is faster but retains compact encoded histories; `uuid` minimizes memory |
| `RECENT_OUTBOX_BATCH_SIZE` | 500 | Durable invalidation read/acknowledgement batch size |
| `RECENT_REDIS_BATCH_SIZE` | 25 | History Redis batch size |
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
