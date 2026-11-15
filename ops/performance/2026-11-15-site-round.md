# Website work reduction — 15 November 2026

This round starts at `23fd231`; the final application source is `73ea8c8` on
local `codex-perf`. All builds, SQL checks, browser fixtures and measurements
run in the local Docker environment. No
changes are pushed. The focus is cold identity lookups, transient search work,
live run refreshes, growing AA history tables and shared CSS.

## Cold player information

The empty-Redis fallback for `getPlayerInfo` used to resolve identity, current
name and customization separately for each requested player. The replacement
uses one parameterized statement containing at most 20 indexed top-one
lookups. It does not enumerate the lifetime user collection. The populated
Redis path and the endpoint's response shape, current-name-only acceptance,
20-name limit and cache headers remain unchanged.

The read-only local fixture compares exact JSON with the previous fallback.
For its 20 names, with the shared ban list already known, SQL statements fall
from 54 to one; the new statement returns 18 rows. EXPLAIN checks indexed pace
lookups without filesorts. Separate read-only CTE cases cover historical and
reused names, banned latest owners, case duplicates, accent/space collation
and unknown names. Redis database 15 stays empty. This is an application-cache
cold check; it does not flush MySQL's buffer pool or the operating-system cache.

Nine alternating in-process pairs, with both variants' SQL shapes prepared
equally on four pool connections, give medians of 10.56 ms for the old four-worker
fallback and 4.71 ms for the new handler. Ranges are 8.63–11.67 ms and
4.28–6.98 ms respectively. Node value caches are cleared between requests; the
first new handler before equal SQL priming took 20.68 ms. The 55% median
reduction describes this local prepared-query workload, not network/API latency
or a fully cold MySQL process.

The PB audit also tested removing unrelated global identity/Twitch rows from
`getAllPBs`. All 3,009 PBs retained byte-identical JSON, but the candidate plans
were slower. A correlated lookup took about 8.4 seconds and a batched grouped
lookup about 2.3 seconds. The best winner-join plan reduced returned SQL rows
from 13,123 to 6,018 and statements from 10 to eight, but repeated local pairs
took about 88–90 ms versus 65 ms for the existing implementation. Those PB
changes were reverted. The rejected patch, read-only fixture, EXPLAIN and JSON
hash are retained as diagnostic artifacts rather than shipped as an improvement.

## Browser requests and speculative work

Visible unknown identities still coalesce into batches of 20, with a new limit
of two active requests. An eight-second timeout releases a hung request's slot.
Unmounting removes pending names and aborts a batch when its last subscriber
leaves. A newer server-rendered identity seed fences out older responses.
Visible rows receive at most one delayed retry after failure. There is no hard
cap on the number of currently mounted unknown identities; the active-request
limit should not be read as a universal memory ceiling.

Search instances share their lazy names/Fuse work. A failed load resets the
shared promise so the next intent can recover, and failed preparation does not
produce an unhandled rejection. Names and query requests have eight-second
timeouts. These changes preserve local/Twitch matching and the existing
debounced remote fallback.

The tentative player-prefetch queue now uses a Map capped at 64 pending paths.
Cancellation removes an entry immediately, rather than retaining cancelled
array entries until a later scan. Strong hover/keyboard intent keeps its
existing direct prefetch behavior. The deterministic fixture resolves 130 cold
identities in seven requests, with at most two active, and confirms that 20,000
cancelled prefetch intents issue no speculative fetches. These are work and
lifecycle checks, not a measured whole-page RAM reduction.

## Repeated run and history updates

Run polling responses contain a transport timestamp even when all run values
are unchanged. SWR now compares every row field and every other snapshot field,
ignoring only that timestamp. Equal responses avoid the React effect and store
writes. Changed split, nickname, VOD, live/unknown and deletion values remain
observable. URL and document-title writes are also guarded when their values
already match. Canonicalization still strips query/hash delimiters.

The actual React/SWR integration fixture sends 20 transport-only responses:
the old component performs 20 store, 20 history and 20 title writes; the new
component performs zero of each. Twenty real metadata changes still perform
20 store updates, with zero redundant history/title writes. Both revisions
perform the same four network reads during the lifecycle check.

The polling interval, focus/reconnect refreshes, unknown-status behavior and
five-second end-of-run grace period retain their previous behavior. In
particular, a run that settles after being live can still receive a corrected
VOD on focus or a deletion on reconnect.

AA history rows are memoized using the stable compact row objects already
produced by the page. A real React fixture starts with 1,000 rows: the previous
component revisits 8,000 existing cells on loading, 16,000 cumulatively through
failure and 32,000 through retry/append. The replacement revisits zero existing
cells during those state changes. New rows still render and the live timestamp
has its own working clock subscription. Normal pages still start with 100 rows
and append 100 at a time; the larger fixture checks accumulated history.

Recent relative-time labels take a shorter calendar path. For 10,000 labels,
Date constructions fall from 60,000 to 10,000 with the same result checksum.
The remaining Date preserves the old local-time normalization at repeated DST
hours. The check compares 14,616 threshold, fractional-millisecond, month, leap
and DST cases against the frozen implementation in four time zones, plus
Date-limit/year-zero cases. Four existing differences from Moment remain
intentionally unchanged. Allocation counts do not establish a process-level
peak CPU or RSS improvement.

## Shared stylesheet

Bootstrap pruning now reads source literals, template segments and class-helper
object keys through the TypeScript parser. Comments, variable names and JSX tag
names no longer keep unrelated selectors alive. Complete dynamic class
alternatives and the explicit runtime-state keep list remain included. The
generated shared stylesheet falls from 32,535 to 30,937 bytes: 1,598 bytes, or
4.9%. This is a raw CSS reduction; complete-document compression and initial
JavaScript are measured separately.

Current application class expressions were independently reviewed. Future
classes assembled from fragments still need complete literals or an explicit
keep entry. Production desktop/mobile style and client-navigation parity are
checked against the frozen baseline.

## Paired browser measurements

The frozen baseline and final production servers use identical installed
dependencies and generated local data, with outbound upstream requests blocked
and external images stubbed. Each cold-page sample uses a fresh Chromium
context, 300 ms HTTP latency, 4x CPU slowdown and 10/5 Mbps download/upload
limits. Three samples per revision alternate order. This clears browser state,
not server/Redis/MySQL caches. Builds and other test workloads are stopped for
the timing series.

Medians in milliseconds:

| Cold page | Content, before → after | Interactive, before → after |
|---|---:|---:|
| Front | 785.9 → 711.8 | 1,356.4 → 1,347.1 |
| Player profile | 490.6 → 486.5 | 1,354.9 → 1,356.2 |
| Pace history | 525.9 → 510.8 | 1,356.8 → 1,352.2 |
| AA history | 521.8 → 512.4 | 1,257.5 → 1,243.8 |
| OBS setup | 447.6 → 444.9 | 1,411.8 → 1,410.1 |
| API docs | 478.9 → 469.6 | 1,205.8 → 1,206.2 |

Interactivity is broadly flat in this small sample. Front content appears
earlier, but its streamed-content readiness varies; this does not establish a
repeatable 9% load-time gain. No page adds a render-blocking stylesheet request.
Median maximum long tasks range from 92–107 ms before and 92–102 ms after;
this is a bounded initial observation, not peak CPU profiling across long-lived
sessions.

The complete streamed document is about 3.2 KB smaller on each measured route.
Observed initial JavaScript increases by roughly 1.7–3.6 KB raw, depending on
route, to add request bounds, cancellation/recovery and the formatting guards.
These byte counts are decoded/direct-Next sizes, not production compressed
wire transfer. The work-reduction fixtures explain the main retained gains;
the browser series does not show a large cold-load speedup.

A separate sequential navigation series uses three complete sessions per
revision in alternating order, with the same latency/CPU settings. Each session
performs 15 timed actions; all 90 actions complete without browser errors. The
table keeps the first and revisited seven-day front ranges separate:

| Navigation/range | Ready, before → after (ms) |
|---|---:|
| Front: 1 day | 449.7 → 460.4 |
| Front: 7 days, first visit | 578.5 → 593.5 |
| Front: 30 days | 487.5 → 495.9 |
| Front: lifetime | 590.8 → 584.5 |
| Front: 7 days, revisit | 166.8 → 170.6 |
| First player navigation | 849.6 → 869.1 |
| Player: 1 day | 387.6 → 391.9 |
| Player: 7 days | 419.5 → 492.7 |
| Player: 30 days | 406.8 → 400.8 |
| Player: lifetime | 381.1 → 383.6 |
| More runs | 117.6 → 144.8 |
| Next history page | 64.1 → 69.2 |
| Recent run detail | 786.9 → 787.8 |
| Debug/tracker history | 161.9 → 184.9 |

These small-sample link/range timings do not demonstrate a navigation speedup.
The slower player-seven-day median includes 107/116 ms long tasks in two final
samples, so it received an additional instrumented investigation. Browser heap
snapshots vary with initialization and garbage collection; they are not forced
GC measurements and do not establish lower peak RAM.

The diagnostic pair records resource initiators, task timing and sampled CPU.
Its seven-day transition measures 438.7 → 413.2 ms with no long task, while
the final first-profile click instead takes 1,364.2 ms versus 862.7 ms. That
delay coincides with the unchanged 244,757-byte Sentry chunk completing and
initializing. A focused capture ending before the later full-document
navigation preserves the CPU profile: **both revisions** have a 61 ms task
around document time 4.9 seconds. In those windows, the same Sentry chunk
accounts for 31.3/34.8 ms self time and webpack initialization 24.6/24.5 ms;
Sentry integration setup has 21.2/21.7 ms inclusive sampled time. GC is not a
dominant sampled frame. The task lands in different actions between sessions.

This shows that unchanged deferred SDK initialization can interfere with a
back-to-back navigation series. It does not prove the original unsampled
107/116 ms tasks were entirely SDK work. The primary slower median is retained,
and this round makes no blanket navigation-speed, peak-CPU or RAM claim. The
focused diagnostic also measures seven days at 382.1 → 433.1 ms, with no long
task; these few samples do not isolate a stable new application hotspot.
The diagnostic JSON/CPU profiles remain separate from the primary medians.

The offline complete-payload probe excludes unused `nomodule` fallback scripts.
At Brotli quality 5, complete HTML snapshots save 290–318 bytes per route;
declared JavaScript grows by 504–1,087 bytes, outweighing that HTML saving. This
round's request/lifecycle protections therefore carry a small initial-code
cost. These are compression estimates, with fonts/images, RSC navigations and
later dynamic SDK downloads excluded.

## Verification and commits

The production webpack build and post-build precompression pass. Full checkout
TypeScript checking passes. ESLint reports zero errors and the same 47 existing
warnings. The final generated stylesheet matches the checked-in 30,937-byte
file.

Focused Docker fixtures cover CSS source scanning, cold SQL/CTE parity,
identity requests/cache/indexing, shared loader recovery, speculative prefetch,
real React search/identity lifecycles, run snapshot field comparison, actual
SWR updates, timer/calendar parity, AA row rendering and existing frontend
clock/rendering behavior. The SQL fixture is read-only and checks that reserved
Redis database 15 remains empty.

The production pair passes all 12 computed-style cases across desktop/mobile
front, AA board, profile, pace/AA history and OBS setup routes, including custom
colors, filters and drawers. Twelve immediate-click client navigation traces
also pass. The navigation suite covers keyboard/touch range controls, hover
cancellation, SSR historical run cards without redundant polling, Back/Forward
run isolation, session cards, overlay resize and Debug/tracker links. Search
dismissal checks Escape/blur cancellation and a subsequent working keyboard
search. The original Docker dev server separately returns complete HTTP-200
HTML for front, profile, both history pages, OBS setup, API docs and run detail.

After measurement, the two owned production servers are stopped, cron is
restored, and the original web/WebSocket/MySQL/Redis services remain running.
Docker health is `healthy`; ports 5050/8080 are open and test ports 5111/5112
are closed. Reserved Redis databases 13, 14 and 15 each contain zero keys. The
unrelated existing `/srv/perf (deleted)` process is preserved. No primary Redis
flush, SQL fixture writes or publishing jobs are used by this round's tests.

| Commit | Retained change |
|---|---|
| `859b1ea` | Prune Bootstrap using source literals rather than comments/identifiers. |
| `89d9664` | Batch the cold player-info SQL fallback. |
| `a6d38a2` | Bound active identity requests, cancel obsolete work and fence seeds. |
| `00c799f` | Recover failed lazy search loads and time out hung requests. |
| `68acbfe` | Cap speculative prefetch queues and release cancelled entries. |
| `bd6585e` | Skip transport-only run updates and redundant URL/title writes. |
| `31ca563` | Reduce recent-label Date allocations with calendar parity. |
| `73ea8c8` | Reuse unchanged AA history rows. |
| `c61b31c`, `55942f3` | Compare cold SQL work fairly and retain strict fixture types. |
| `c667775` | Document focused checks and paired production measurements. |

Reproduction commands are in `scripts/PERFORMANCE.md`. Detailed measurements,
logs, actual query plans, rejected PB diagnostics and fixture comparisons are
under ignored `test-artifacts/performance/site-round/`.
