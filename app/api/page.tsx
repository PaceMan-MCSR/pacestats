'use client'

import "@/app/styles/api.css"

type Endpoint = {path: string; method?: string; summary: string; params?: string; returns: string; notes?: string; rateLimit?: string}

const endpoints: Endpoint[] = [
  {path: 'getLeaderboard', summary: 'Pace leaderboard slice.', params: 'days: 1, 7, 30, or 9999 (30); category (nether); type: count, average, fastest, or conversion (count); limit (10, max 999999).', returns: 'Array of leaderboard entries.'},
  {path: 'getFastest', summary: 'Fastest runs for one pace category.', params: 'days: 1, 7, 30, or 9999 (30); category (nether); limit (10, max 999999).', returns: 'Array of fastest-run entries.'},
  {path: 'getWorld', summary: 'One run, by numeric stats ID or PaceMan world hash.', params: 'worldId (required).', returns: '{ data, time, isLive } or null.'},
  {path: 'getRecentRuns', summary: 'Recent pace runs for a player.', params: 'name; hours (lifetime by default); hoursBetween (lifetime by default); limit (10).', returns: 'Array of pace runs.'},
  {path: 'getRecentTimestamps', summary: 'Timestamped split data for recent pace runs.', params: 'name; limit (20, max 50); onlyFort (false).', returns: 'Array of timestamp/split records.'},
  {path: 'getLatestRun', summary: 'Latest pace run for a player.', params: 'name; forceName (false).', returns: 'One run object, [] when none, or { error: "Unknown user" }.'},
  {path: 'getLatestCompletion', summary: 'Latest completed pace run for a player.', params: 'name.', returns: 'One completion object or { error: "Unknown user" }.'},
  {path: 'getPBs', summary: 'Personal-best completions.', params: 'names: comma-separated names; uuids: comma-separated UUIDs. Either may be omitted.', returns: 'Array of PB records.'},
  {path: 'getNickAlways', summary: 'Resolve the current nickname for a UUID.', params: 'uuid.', returns: '{ name }.'},
  {path: 'getAllUsers', summary: 'All known player names and Twitch aliases.', returns: 'Array of user records.'},
  {path: 'getRunsPaginated', summary: 'Legacy global pace-run pagination.', params: 'page (1). Pages contain up to 10,000 ID-range rows.', returns: '{ pageCount, runs }, or { error, pageCount, runs }.'},
  {path: 'getSessionStats', summary: 'Session counts and averages for every split.', params: 'name; hours (24); hoursBetween (6).', returns: 'Object keyed by nether, bastion, fortress, first_structure, second_structure, first_portal, stronghold, end, and finish.'},
  {path: 'getSessionNethers', summary: 'Session nether count, average, and RNPH.', params: 'name; hours (24); hoursBetween (6); liveOnly (false); dp (0–3).', returns: '{ count, avg, rnph, uuid }.'},
  {path: 'getSplitStats', summary: 'Session count and average for one split.', params: 'name; hours (24); hoursBetween (6); split (nether); maxTime (99999999).', returns: '{ count, avg, ms }.'},
  {path: 'getCombinedStats', summary: 'Combined session stats for several players.', params: 'names: comma-separated; hours (24); hoursBetween (6); start (0).', returns: 'Object keyed by split, each containing count and avg.'},
  {path: 'getCombinedNethers', summary: 'Combined session nether count and average.', params: 'names: comma-separated; hours (24); hoursBetween (6); start (0); maxTime (99999999).', returns: '{ count, avg }.'},
  {path: 'getNPH', summary: 'ResetTracker nether-per-hour statistics.', params: 'name; hours (24); hoursBetween (2); liveOnly (false).', returns: 'NPH statistics object.'},
  {path: 'deleteRun', summary: 'Protected deletion of a pace run.', params: 'runId; key: required query-string API key.', returns: '{ success: boolean }.', notes: 'GET endpoint retained for legacy clients.'},
  {path: 'submitStats', method: 'POST', summary: 'Submit ResetTracker statistics for a run.', params: 'JSON body: accessKey, gameData (JSON string), wallTime, playTime, seedsPlayed, resets, totalResets, netherTime.', returns: '{ status: "success" } or { status: "error", message }.'},
  {path: 'searchPlayers', summary: 'Search player nicknames and Twitch aliases.', params: 'q: at least 2 characters; limit (8, max 20).', returns: 'Array of { id, name, displayName, color, bgColor }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getPlayerRuns', summary: 'Paginated pace history for one UUID.', params: 'uuid; beforeId + limit for cursor pagination, or page + pageSize (10, 25, 50, 100) + optional JSON filters for offset pagination.', returns: 'Cursor mode: { rows, nextCursor, hasMore, loadedCount }. Page mode: { rows, rowCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getAAPlayerRuns', summary: 'Cursor-paginated All Advancements history for one UUID.', params: 'uuid; beforeId: exclusive cursor; limit (25, max 100).', returns: '{ rows, nextCursor, hasMore, loadedCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: '../aa/api/getAllData', summary: 'All Advancements export.', params: 'days: 1, 7, 30, or 9999 (30).', returns: '{ data: [...] }.', notes: 'This route is prefixed with /stats/aa/api/, not /stats/api/.'},
]

export default function Page() {
  return <main className="container mb-5">
    <div className="row justify-content-center mt-4"><div className="col-12 text-center"><h1 className="header">API Documentation</h1></div></div>
    <p>All paths below are relative to <code>https://paceman.gg/stats/api/</code>. Responses are JSON. Existing endpoints preserve their legacy response shapes; the cursor endpoints are additive.</p>
    <p><b>Rate limiting:</b> Every API route is limited per client IP in a fixed 60-second window. Large pace and AA exports allow 6 requests; global 10,000-row pagination allows 12; deletion allows 30; combined analytics allow 60; the all-users export allows 90; submission, search, and cursor histories allow 120; cached leaderboards, fastest runs, and live-run reads allow 240; other player-stat routes allow 180. A breach returns HTTP 429 with <code>{'{ error: "Too many requests" }'}</code> and <code>Retry-After</code>. Limits are in-process, so deployment-level limits may also apply.</p>
    <p>Player lookup parameters accept either a Minecraft nickname or Twitch name where stated. Invalid player lookups return <code>{'{ error: "Unknown user" }'}</code> with HTTP 404 unless noted otherwise.</p>
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
