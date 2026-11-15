# Cold page and API investigation — 2026-11-15

Baseline: `95aaaa2`. Application candidate: `5818880`, on local `codex-perf`.
No changes were pushed. All runtime checks used the local `pacestats-dev`
Docker environment and its imported MySQL/Redis data.

## Retained changes

- **Cold identity:** resolve the latest nickname/Twitch association and current
  nickname in one SQL statement instead of two. Both indexed top-one reads are
  retained. The result preserves the association's original UUID spelling,
  historical/reused names, collation, bans, cached nulls and existing name-cache
  entries or in-flight work. Unknown names still need one statement.
- **AA profile reads:** read rank-relevant UUID/quantity/value tuples and branch
  counts in one Redis pipeline rather than downloading complete leaderboard
  entries with names and averages. Exact ties, order and minimum-quantity rules
  are unchanged. Malformed documents use the legacy complete-document path;
  missing documents or Redis I/O failures go directly to SQL. Complete-board
  caches and in-flight work take precedence, without extending their TTL.
- **Secondary player headers:** AA profile/history, session and NPH tracker pages
  seed existing customization alongside their independent body reads. This
  removes a hydration-followed-by-identity-fetch waterfall. An optional read has
  a 100 ms deadline; a timeout or failure leaves the existing browser fallback
  available. The cached lookup may finish for another request, with late errors
  handled and the deadline timer cleared on completion.
- **Empty date ranges:** share a zero-length numeric buffer until the first
  streamed value. A real empty one-day profile avoids ten allocations totaling
  81,920 bytes; empty NPH avoids 8,192 bytes. Populated lifetime results and
  allocation growth match the baseline. These are transient typed allocations,
  not whole-process memory savings.
- **Profile structure switch:** both structure views are already included in
  the profile model. Switching them now updates the URL without an RSC request.
  Query parameters, initial separate view and Back/Forward remain correct.
  Front-page and history switches continue to request their required data.

## Evidence and limits

Raw artifacts are retained locally under
`test-artifacts/performance/cold-loads/`, `cold2/` and `cold-round/`.

Nine alternating pairs of 20 mixed, sequential identity lookups use 35 SQL
statements before and 20 after. With Node results cleared between lookups and
equally prepared SQL, the median batch changes from 24.21 to 19.92 ms. This is
read-only local SQL timing, not an HTTP or browser latency claim. The final
corrected UUID-preserving query was measured again; earlier prototype timings
are not used here.

The AA fixture compares every actual profile across the four supported periods
(189 profile/period checks including missing players), synthetic ties, all
property-order permutations, omitted properties/rows, fallback paths, near-expiry
caches, in-flight reuse and cache retention at 12,800 rows. Three missing/error
cases each require one projection pipeline, zero additional root reads and one
SQL checkout across two profiles.

AA lifetime Redis reply payload drops from 345,511 to 157,760 bytes (54%), including
the validation counts. Seven-day and 30-day replies drop from 74,228 to 34,839
and 123,758 to 57,082 bytes. Empty one-day replies grow from 431 to 1,590 bytes;
the fixed query-path overhead is a small-range tradeoff. This is Redis reply
size, not browser transfer size. The read/parse/rank probe is separate from
whole-page timing and does not clear MySQL or OS buffers.
Across 30 rotating samples per period, read/parse/rank medians are
0.175→0.324 ms (empty one-day), 0.450→0.488 ms (seven-day),
0.656→0.603 ms (30-day) and 1.992→1.352 ms (lifetime). The small-period overhead
is explicit; no uniform time improvement is claimed.

A proposed filtered customization projection was **rejected**. Although its
reply shrank from 579,303 to 22,026 bytes, the local Redis filtering work increased
median read time from 2.60 to 3.77 ms across 20 alternating samples. The existing
reader remains in place.

## Verification

- Production webpack builds, full TypeScript and full ESLint (no errors; existing
  image warnings remain).
- Read-only identity parity, indexed plans, cached/in-flight names, bans and raw
  UUID casing; numeric-allocation parity on empty and populated SQL windows.
- Four page-body/metadata comparisons in six modes each: custom, default,
  unavailable, stalled, alias and unknown. A late rejection after the optional
  deadline is handled.
- Independent producer parity for empty-cache profile/NPH and AA SQL fallback.
- Forty fresh production browser contexts compare desktop/mobile default and
  custom headers, alias/mixed-case URLs, navigation/search/drawer styles and
  exact seed fields. Every baseline makes one identity request; every candidate
  makes zero. No browser errors.
- Production profile tables/links match; AA range switches, More runs, history
  pagination and Back to Profile pass. The structure fixture confirms one→zero
  profile RSC requests, all four ranges, retained query parameters, initial
  separate-view rendering and Back/Forward. Front navigation still works.
- Empty-Redis HTTP checks retain useful profile/API responses, retryable
  `CACHE_NOT_READY` leaderboards and rejected invalid queries.

## Cold-browser header results

Three alternating samples per revision/route, fresh Chromium contexts, 300 ms
HTTP latency, 10/5 Mbps and 4× CPU. Remote services/images use identical local
fixtures. These runs keep server/Redis/MySQL caches; they measure browser cold
loads, separately from the fresh-process benchmark.

| Custom player route | Final theme before→after | Main content before→after |
| --- | ---: | ---: |
| AA profile | 1551.5→1226.7 ms | 480.1→477.5 ms |
| AA history | 1552.1→1223.9 ms | 451.6→452.1 ms |
| Session | 1548.9→1219.1 ms | 473.2→470.2 ms |
| NPH tracker | 1558.1→1233.3 ms | 493.0→493.9 ms |

The custom header becomes ready 325–330 ms earlier by removing one sequential
API round trip. Initial content and header hydration remain broadly flat;
this is not a claim that the whole page loads 330 ms faster. Median long-task
time remains 92–100 ms, with AA profile 93→100 ms; no CPU improvement is claimed
from this browser measurement. Raw timing includes every resource and task.

## Fresh-process and general page results

`perf-cold-start.mjs` completes 72 useful 200 responses: six cases × two revisions
× two Redis states × three alternating rounds. Every sample gets a fresh
production Next process and exactly one first HTTP request. Readiness uses a TCP
probe, not an application request. Private child processes are stopped after
each sample. MySQL/OS buffers are not flushed; this is a cold application process
and optionally empty Redis, not a cold physical database. No browser emulation
applies to these direct localhost requests.

Medians before→after, including imported application/instrumentation work during
the request. RSS is a 10 ms sample of the launched Node process only. CPU uses
Linux process ticks and includes multiple worker threads; it is not a utilization
or spike ceiling. TCP-bind startup is recorded separately in the raw data.

| Redis | First request | HTTP ms | CPU ms | Sampled peak RSS MiB |
| --- | --- | ---: | ---: | ---: |
| Warm | Front lifetime | 521.5→506.2 | 620→600 | 190.7→189.1 |
| Warm | Profile lifetime | 501.3→511.8 | 580→590 | 188.3→186.0 |
| Warm | Profile one-day | 503.6→512.1 | 580→590 | 185.1→185.9 |
| Warm | AA profile lifetime | 511.8→505.9 | 590→580 | 187.1→186.2 |
| Warm | Latest-completion API | 477.7→480.3 | 550→560 | 186.0→183.5 |
| Warm | Recent-runs API | 480.0→479.9 | 560→550 | 184.4→192.2 |
| Empty | Front lifetime/retry | 502.3→494.4 | 580→570 | 184.8→187.7 |
| Empty | Profile lifetime | 557.3→553.1 | 670→660 | 218.2→214.0 |
| Empty | Profile one-day | 510.0→507.1 | 580→580 | 183.6→185.1 |
| Empty | AA profile lifetime | 597.1→586.0 | 680→670 | 221.9→222.2 |
| Empty | Latest-completion API | 475.6→480.7 | 550→560 | 182.5→182.6 |
| Empty | Recent-runs API | 480.9→475.7 | 550→540 | 182.4→183.2 |

These results are broadly flat at whole-process scale, including small slower
cases. Three samples do not establish a general cold-start or CPU/RSS
improvement. The approximately half-second common first-request cost remains;
the retained changes reduce specific work and the browser identity waterfall.
The earlier partial harness run failed an overly literal AA heading assertion
because streamed HTML contains React comments between text nodes; its artifacts
are retained as `cold-start-probe-assertion.*`. The corrected complete run is
`cold-start.json`/`.log`.

The broader cold-browser probe completes 36 fresh contexts using the same
300 ms/4× setup, three alternating samples per revision on six routes.

| Page | Content before→after | Controls ready before→after |
| --- | ---: | ---: |
| Front | 702.7→707.1 ms | 1353.5→1355.2 ms |
| Profile | 482.9→485.0 ms | 1353.4→1357.1 ms |
| Pace history | 519.7→494.2 ms | 1355.8→1354.2 ms |
| AA history | 511.3→518.8 ms | 1241.5→1254.2 ms |
| OBS setup | 446.5→445.0 ms | 1411.6→1411.5 ms |
| API documentation | 473.4→476.7 ms | 1191.9→1204.5 ms |

General content/control readiness is broadly flat, with small slower cases.
The AA history seed adds about 505 bytes of HTML and 4.3 KB of decoded initial
JavaScript in this build. The separate header benchmark waits for the final
custom colors and completed identity lookup, exposing the removed round trip;
the general probe stops at initial control readiness. CSS and blocking-request
counts remain unchanged. No bundle-size improvement is claimed for this round.

## Cleanup

Only this round's verified snapshot servers were stopped; private fresh-process
children also exited. Ports 5121–5126 are closed, 5050/8080 remain open. The
pre-existing unrelated `/srv/perf (deleted)` process is preserved. Cron was
restarted; Docker reports healthy and the original web, WebSocket, MySQL and
Redis services remain running. Reserved Redis 13/14/15 each contain zero keys.
No SQL fixtures, primary-cache flushes or publishing jobs were used.

Final full typecheck and ESLint pass (zero errors, 47 existing image warnings),
and `git diff --check` passes. Runtime artifacts remain local and ignored.
All retained changes and verification scripts are committed on `codex-perf`;
nothing was pushed.
