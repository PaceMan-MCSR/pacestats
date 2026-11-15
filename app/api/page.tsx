import "@/app/styles/api.css"
import {apiExamples, exampleRequestUrl, exampleResponsePreview, type ApiEndpointPath} from "./_examples"

// Keep the prebuilt docs inexpensive without advertising a one-year HTML TTL
// to shared caches. Deployment also rotates nginx's cache namespace.
export const revalidate = 60;

type Endpoint = {path: ApiEndpointPath; method?: string; summary: string; params?: string; returns: string; notes?: string; rateLimit?: string}

const exportParams = 'name or uuid (exactly one required); from: inclusive UTC date YYYY-MM-DD (1970-01-01); to: exclusive UTC date YYYY-MM-DD (tomorrow); mode: daily or records (daily); format: json or csv (json); limit: records only (1000, max 5000); cursor: records only.'
const exportReturns = 'Daily totals or paginated records, as JSON or CSV.'
const exportRateLimit = '6 requests/minute; 2 concurrent exports per endpoint.'

const endpoints: Endpoint[] = [
  {path: 'getLeaderboard', summary: 'Pace leaderboard slice.', params: 'days: 1, 7, 30, or 9999 (30); category (nether); type: qty, average, fastest, or conversion (qty); limit (10, max 999999).', returns: 'Array of leaderboard entries.'},
  {path: 'getFastest', summary: 'Fastest runs for one pace category.', params: 'days: 1, 7, 30, or 9999 (30); category (nether); limit (10, max 999999).', returns: 'Array of fastest-run entries.'},
  {path: 'getWorld', summary: 'One run, by numeric stats ID or PaceMan world hash.', params: 'worldId (required).', returns: '{ data, time, isLive } or null.'},
  {path: 'getRecentRuns', summary: 'Recent pace runs for a player.', params: 'name; hours (lifetime by default); hoursBetween (lifetime by default); limit (10, maximum 1000).', returns: 'Array of pace runs.'},
  {path: 'getRecentTimestamps', summary: 'Timestamped split data for recent pace runs.', params: 'name; limit (20, max 50); onlyFort (false).', returns: 'Array of timestamp/split records.'},
  {path: 'getLatestRun', summary: 'Latest pace run for a player.', params: 'name; forceName (false).', returns: 'One run object, [] when none, or { error: "Unknown user" }.'},
  {path: 'getLatestCompletion', summary: 'Latest completed pace run for a player.', params: 'name.', returns: 'Array containing the latest completion, [] when none, or { error: "Unknown user" }.'},
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
  {path: 'exportStats', summary: 'Export pace runs and splits for a player.', params: exportParams, returns: exportReturns, rateLimit: exportRateLimit},
  {path: 'exportResetStats', summary: 'Export ResetTracker stats for a player.', params: exportParams, returns: exportReturns, rateLimit: exportRateLimit},
  {path: 'submitStats', method: 'POST', summary: 'Submit ResetTracker statistics for a run.', params: 'JSON body: accessKey, gameData (JSON string with worldId, gameVersion "1.16.1", category "ANY"), wallTime, playTime, seedsPlayed, resets, totalResets; optional netherTime (0). Times must be integers from 0 to 4,294,967,295; seedsPlayed from 0 to 65,535; resets and totalResets from 0 to 2,147,483,647. Resets are capped at 20,000.', returns: '{ status: "success" } or { status: "error", message }.'},
  {path: 'searchPlayers', summary: 'Search player nicknames and Twitch aliases.', params: 'q: at least 2 characters; limit (8, max 20).', returns: 'Array of { id, name, displayName, color, bgColor }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getPlayerRuns', summary: 'Paginated pace history for one UUID.', params: 'uuid; beforeId + limit for cursor pagination, or page + pageSize (10, 25, 50, 100) + optional JSON filters for offset pagination.', returns: 'Cursor mode: { rows, nextCursor, hasMore, loadedCount }. Page mode: { rows, rowCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getAAPlayerRuns', summary: 'Cursor-paginated All Advancements history for one UUID.', params: 'uuid; beforeId: exclusive cursor; limit (25, max 100).', returns: '{ rows, nextCursor, hasMore, loadedCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: '../aa/api/getAllData', summary: 'All Advancements export.', params: 'days: 1, 7, 30, or 9999 (30).', returns: '{ data: [...] }.', notes: 'This route is prefixed with /stats/aa/api/, not /stats/api/.'},
]

function EndpointBlock({endpoint}: {endpoint: Endpoint}) {
  const example = apiExamples[endpoint.path];
  const url = exampleRequestUrl(endpoint.path);
  const preview = exampleResponsePreview(example.response);
  const requestBody = 'requestBody' in example ? example.requestBody : undefined;

  return <section className="apiBlock" id={endpoint.path.replaceAll('/', '-')}>
    <h3><code>{endpoint.method || 'GET'} /{endpoint.path}</code></h3>
    <p>{endpoint.summary}</p>
    {endpoint.params && <p><b>Parameters:</b> {endpoint.params}</p>}
    <p><b>Response:</b> <code>{endpoint.returns}</code></p>
    {endpoint.rateLimit && <p><b>Rate limit:</b> {endpoint.rateLimit}</p>}
    {endpoint.notes && <p><b>Note:</b> {endpoint.notes}</p>}
    <p><b>Example URL:</b> {endpoint.method === 'POST'
      ? <code className="apiExampleUrl">{url}</code>
      : <a className="apiExampleUrl" href={url}><code>{url}</code></a>}
    </p>
    {requestBody && <div className="apiExampleRequestBody">
      <h4>Example JSON body</h4>
      <pre tabIndex={0} aria-label={`Example request body for ${endpoint.path}`}><code>{JSON.stringify(requestBody, null, 2)}</code></pre>
    </div>}
    <details className="apiExampleResponse">
      <summary>Example response{preview.truncated && <span> (truncated)</span>}</summary>
      <p className="apiExampleNote">Illustrative data.{preview.truncated && ' Additional array items, fields, or long values are omitted.'}</p>
      <pre tabIndex={0} aria-label={`Example response for ${endpoint.path}`}><code>{preview.json}</code></pre>
    </details>
  </section>
}

export default function Page() {
  return <main className="container mb-5">
    <div className="row justify-content-center mt-4"><div className="col-12 text-center"><h1 className="header">API Endpoints</h1></div></div>
    <div className="row"><div className="col-12">{endpoints.map(endpoint => <EndpointBlock endpoint={endpoint} key={endpoint.path}/>)}</div></div>
  </main>
}
