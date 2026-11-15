import "@/app/styles/api.css"

// Keep the prebuilt docs inexpensive without advertising a one-year HTML TTL
// to shared caches. Deployment also rotates nginx's cache namespace.
export const revalidate = 60;

type Endpoint = {path: string; method?: string; summary: string; params?: string; returns: string; notes?: string; rateLimit?: string}

const exportParams = 'Exactly one player selector is required: name (Minecraft nickname or Twitch name) OR uuid (32 hexadecimal characters, or the 36-character hyphenated form; case-insensitive). Both selectors, neither selector, or a blank selector return HTTP 400. from: inclusive UTC date YYYY-MM-DD (1970-01-01); to: exclusive UTC date YYYY-MM-DD (tomorrow, also the maximum); mode: daily or records (daily); format: json or csv (json). Records mode only: limit (1000, max 5000); cursor from the previous page. Dates must be on or after 1970-01-01, and from must be before to.'
const exportReturns = 'Daily JSON: { dataset, player, range, mode, rows, summary, notes }. Records JSON: { dataset, player, range, mode, rows, limit, hasMore, nextCursor, notes }. CSV downloads contain the same row columns, without the JSON wrapper.'
const exportRateLimit = '6 requests per 60 seconds per client IP for each endpoint, with at most 2 exports being prepared at once per endpoint.'

const endpoints: Endpoint[] = [
  {path: 'getLeaderboard', summary: 'Pace leaderboard slice.', params: 'days: 1, 7, 30, or 9999 (30); category (nether); type: count, average, fastest, or conversion (count); limit (10, max 999999).', returns: 'Array of leaderboard entries.'},
  {path: 'getFastest', summary: 'Fastest runs for one pace category.', params: 'days: 1, 7, 30, or 9999 (30); category (nether); limit (10, max 999999).', returns: 'Array of fastest-run entries.'},
  {path: 'getWorld', summary: 'One run, by numeric stats ID or PaceMan world hash.', params: 'worldId (required).', returns: '{ data, time, isLive } or null.'},
  {path: 'getRecentRuns', summary: 'Recent pace runs for a player.', params: 'name; hours (lifetime by default); hoursBetween (lifetime by default); limit (10, maximum 1000).', returns: 'Array of pace runs.'},
  {path: 'getRecentTimestamps', summary: 'Timestamped split data for recent pace runs.', params: 'name; limit (20, max 50); onlyFort (false).', returns: 'Array of timestamp/split records.'},
  {path: 'getLatestRun', summary: 'Latest pace run for a player.', params: 'name; forceName (false).', returns: 'One run object, [] when none, or { error: "Unknown user" }.'},
  {path: 'getLatestCompletion', summary: 'Latest completed pace run for a player.', params: 'name.', returns: 'One completion object or { error: "Unknown user" }.'},
  {path: 'getPBs', summary: 'Personal-best completions.', params: 'names: comma-separated names; uuids: comma-separated UUIDs. Either may be omitted.', returns: 'Array of PB records.'},
  {path: 'getNickAlways', summary: 'Resolve the current nickname for a UUID.', params: 'uuid.', returns: '{ name }.'},
  {path: 'getAllUsers', summary: 'All known player names and Twitch aliases.', returns: 'Array of user records.'},
  {path: 'getRunsPaginated', summary: 'Legacy global pace-run pagination.', params: 'page (1); pageSize (10000, maximum 10000). Limited to 12 requests/minute. Smaller pages reduce transfer and processing.', returns: '{ pageCount, runs }, or { error, pageCount, runs }.'},
  {path: 'getSessionStats', summary: 'Session counts and averages for every split.', params: 'name; hours (24); hoursBetween (6).', returns: 'Object keyed by nether, bastion, fortress, first_structure, second_structure, first_portal, stronghold, end, and finish.'},
  {path: 'getSessionNethers', summary: 'Session nether count, average, and RNPH.', params: 'name; hours (24); hoursBetween (6); liveOnly (false); dp (0–3).', returns: '{ count, avg, rnph, uuid }.'},
  {path: 'getSplitStats', summary: 'Session count and average for one split.', params: 'name; hours (24); hoursBetween (6); split (nether); maxTime (99999999).', returns: '{ count, avg, ms }.'},
  {path: 'getCombinedStats', summary: 'Combined session stats for several players.', params: 'names: at most 20 comma-separated names; hours (24); hoursBetween (6); start (0). Shared limit: 30 requests/minute.', returns: 'Object keyed by split, each containing count and avg.'},
  {path: 'getCombinedNethers', summary: 'Combined session nether count and average.', params: 'names: at most 20 comma-separated names; hours (24); hoursBetween (6); start (0); maxTime (99999999). Shared limit: 30 requests/minute.', returns: '{ count, avg }.'},
  {path: 'getNPH', summary: 'ResetTracker nether-per-hour statistics.', params: 'name; hours (24); hoursBetween (2); liveOnly (false).', returns: 'NPH statistics object.'},
  {path: 'exportStats', summary: 'Download a player’s historical PaceMan pace runs and splits, including runs without ResetTracker data.', params: exportParams, returns: exportReturns, notes: 'dataset is stats. Daily rows count runs, split entries, and completions and report fastest nether and completion times. The summary covers the entire range. Records mode preserves individual stored runs and split times, ordered from oldest to newest by run insert time and ID.', rateLimit: exportRateLimit},
  {path: 'exportResetStats', summary: 'Download a player’s historical ResetTracker submissions to compare NPH, nether entries, previews, and resets across years.', params: exportParams, returns: exportReturns, notes: 'dataset is resetStats. Daily rows and the range summary include counts, tracked play and wall time, and weighted NPH. Records mode preserves individual ResetTracker submissions, ordered from oldest to newest by submission time and ID. Only submitted ResetTracker data is available.', rateLimit: exportRateLimit},
  {path: 'deleteRun', summary: 'Protected deletion of a pace run.', params: 'runId; key: required query-string API key.', returns: '{ success: boolean }.', notes: 'GET endpoint retained for legacy clients.'},
  {path: 'submitStats', method: 'POST', summary: 'Submit ResetTracker statistics for a run.', params: 'JSON body: accessKey, gameData (JSON string with worldId, gameVersion "1.16.1", category "ANY"), wallTime, playTime, seedsPlayed, resets, totalResets; optional netherTime (0). Times must be integers from 0 to 4,294,967,295; seedsPlayed from 0 to 65,535; resets and totalResets from 0 to 2,147,483,647. Resets are capped at 20,000.', returns: '{ status: "success" } or { status: "error", message }.'},
  {path: 'searchPlayers', summary: 'Search player nicknames and Twitch aliases.', params: 'q: at least 2 characters; limit (8, max 20).', returns: 'Array of { id, name, displayName, color, bgColor }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getPlayerRuns', summary: 'Paginated pace history for one UUID.', params: 'uuid; beforeId + limit for cursor pagination, or page + pageSize (10, 25, 50, 100) + optional JSON filters for offset pagination.', returns: 'Cursor mode: { rows, nextCursor, hasMore, loadedCount }. Page mode: { rows, rowCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getAAPlayerRuns', summary: 'Cursor-paginated All Advancements history for one UUID.', params: 'uuid; beforeId: exclusive cursor; limit (25, max 100).', returns: '{ rows, nextCursor, hasMore, loadedCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: '../aa/api/getAllData', summary: 'All Advancements export.', params: 'days: 1, 7, 30, or 9999 (30).', returns: '{ data: [...] }.', notes: 'This route is prefixed with /stats/aa/api/, not /stats/api/.'},
]

export default function Page() {
  return <main className="container mb-5">
    <div className="row justify-content-center mt-4"><div className="col-12 text-center"><h1 className="header">API Documentation</h1></div></div>
    <p>All paths below are relative to <code>https://paceman.gg/stats/api/</code>. Responses are JSON unless a CSV export is requested. Existing endpoints preserve their legacy response shapes; the cursor endpoints are additive.</p>
    <p><b>Rate limiting:</b> Every API route is limited per client IP in a fixed 60-second window. Pace, ResetTracker, and AA exports allow 6 requests per endpoint; global 10,000-row pagination allows 12; deletion allows 30; combined analytics allow 60; the all-users export allows 90; submission, search, and cursor histories allow 120; cached leaderboards, fastest runs, and live-run reads allow 240; other player-stat routes allow 180. A breach returns HTTP 429 with <code>{'{ error: "Too many requests" }'}</code> and <code>Retry-After</code>. Limits are in-process, so deployment-level limits may also apply.</p>
    <p>Player lookup parameters accept either a Minecraft nickname or Twitch name where stated. Unknown or unavailable players return <code>{'{ error: "Unknown user" }'}</code> with HTTP 404 unless noted otherwise. Malformed lookup parameters return HTTP 400.</p>
    <section className="apiBlock" aria-labelledby="player-export-examples">
      <h2 id="player-export-examples" className="header">Export your historical data</h2>
      <p>Choose <code>exportStats</code> for PaceMan run and split history or <code>exportResetStats</code> for ResetTracker data such as NPH, previews, and resets. Both support earlier years without a 90-day cutoff, UTC date ranges, JSON, and spreadsheet-friendly CSV.</p>
      <p>For either export, provide exactly one nonempty <code>name</code> or <code>uuid</code>. UUIDs accept 32 hexadecimal characters or the standard 36-character hyphenated form, in either letter case. Supplying both selectors, neither selector, or an empty selector returns HTTP 400.</p>
      <p><code>name</code> uses the same lookup as the other player endpoints: Minecraft nickname first, then Twitch name, with case-insensitive matching and the same current or historical name associations and player restrictions. UUID lookup resolves the stored player directly. Unknown or unavailable players return HTTP 404. JSON responses identify the player with the canonical stored UUID and current nickname in <code>player</code>; <code>player.name</code> can be <code>null</code> if no nickname is stored.</p>
      <h3>PaceMan runs and splits</h3>
      <p>Download all 2024 daily pace totals, replacing <code>YOUR_NAME</code> with your Minecraft nickname or Twitch name:</p>
      <p><code>https://paceman.gg/stats/api/exportStats?name=YOUR_NAME&amp;from=2024-01-01&amp;to=2025-01-01&amp;format=csv</code></p>
      <p>Or use your UUID, replacing <code>YOUR_UUID</code> with either accepted UUID format:</p>
      <p><code>https://paceman.gg/stats/api/exportStats?uuid=YOUR_UUID&amp;from=2024-01-01&amp;to=2025-01-01&amp;format=csv</code></p>
      <p>Daily rows contain run counts, entries into each split (including both portals), completions, and fastest nether and completion times. Split counts include each non-null stored split. Individual runs include their world ID, nickname, insert and update timestamps, IGT/RTA splits, and stored milestones such as iron, lava, bastion loot, obsidian, and rods. Times are milliseconds, with null, zero, and negative values preserved as stored. These exports include pace runs without ResetTracker submissions and use stored split values rather than trimmed leaderboard averages.</p>
      <p>For individual runs: <code>exportStats?name=YOUR_NAME&amp;from=2024-01-01&amp;to=2025-01-01&amp;mode=records&amp;limit=1000</code>.</p>
      <h3>ResetTracker submissions</h3>
      <p>Download all 2024 daily ResetTracker totals:</p>
      <p><code>https://paceman.gg/stats/api/exportResetStats?name=YOUR_NAME&amp;from=2024-01-01&amp;to=2025-01-01&amp;format=csv</code></p>
      <p>Or select the same player by UUID:</p>
      <p><code>https://paceman.gg/stats/api/exportResetStats?uuid=YOUR_UUID&amp;from=2024-01-01&amp;to=2025-01-01&amp;format=csv</code></p>
      <p>For individual submissions: <code>exportResetStats?name=YOUR_NAME&amp;from=2024-01-01&amp;to=2025-01-01&amp;mode=records&amp;limit=1000</code>.</p>
      <p><code>netherEnters</code> counts submitted ResetTracker records. <code>previewsPlayed</code> is a separate count. <code>resetRecords</code> shows how many submissions include reset data. In daily totals and summaries, <code>resets</code> sums the available counts and is <code>null</code> when none are available; <code>resetsPerEnter</code> is <code>null</code> unless all records include reset data. Raw records preserve negative reset counters that indicate unavailable historical values. The raw <code>totalResets</code> field is a lifetime counter and should not be added across records.</p>
      <p>RNPH is nether entries × 3,600,000 ÷ (wall time + play time); LNPH uses play time alone. Exported times are milliseconds. Rates are rounded to two decimal places and are <code>null</code> when the denominator is zero. Daily totals and range summaries recompute rates from their combined counts and times.</p>
      <p>Raw records include the pace run’s in-game nether-entry time as <code>netherTimeMs</code> and ResetTracker’s separate nether time as <code>trackerNetherTimeMs</code>, which can be unavailable. <code>isAccurate</code> is preserved on each record, and <code>accurateRecords</code> counts flagged records in daily totals and summaries. All submitted records are included regardless of this flag.</p>
      <p>ResetTracker rows use the UTC submission date. Tracked time covers the interval since the previous nether entry and can span midnight or the selected date boundary. Exports cannot reconstruct untracked play or resets.</p>
      <h3>Date ranges and pagination</h3>
      <p><code>from</code> includes that date, and <code>to</code> excludes it. Daily rows include only dates with stored records; missing days do not prove that no games were played. Daily JSON includes a summary across the entire selected range.</p>
      <p>Both record exports return up to <code>limit</code> rows at a time. Keep the same endpoint, <code>name</code> or <code>uuid</code>, and dates and send the returned <code>nextCursor</code> as <code>cursor</code> until <code>hasMore</code> is false. CSV pages expose these values in <code>X-Next-Cursor</code> and <code>X-Has-More</code> response headers; both formats include a <code>Link</code> header for the next page when one exists. Cursors belong to the selected endpoint and date range.</p>
    </section>
    <div className="row"><div className="col-12"><h2 className="header">Endpoints</h2>{endpoints.map(endpoint => <section className="apiBlock" id={endpoint.path.replaceAll('/', '-')} key={endpoint.path}>
      <h3><code>{endpoint.method || 'GET'} /{endpoint.path}</code></h3>
      <p>{endpoint.summary}</p>
      {endpoint.params && <p><b>Parameters:</b> {endpoint.params}</p>}
      <p><b>Response:</b> <code>{endpoint.returns}</code></p>
      {endpoint.rateLimit && <p><b>Rate limit:</b> {endpoint.rateLimit}</p>}
      {endpoint.notes && <p><b>Note:</b> {endpoint.notes}</p>}
    </section>)}</div></div>
  </main>
}
