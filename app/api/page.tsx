import "@/app/styles/api.css"
import {apiExamples, exampleRequestUrl, exampleResponsePreview, type ApiEndpointPath} from "./_examples"

// Keep the prebuilt docs inexpensive without advertising a one-year HTML TTL
// to shared caches. Deployment also rotates nginx's cache namespace.
export const revalidate = 60;

type Endpoint = {path: ApiEndpointPath; params?: string[]; returns: string; notes?: string; rateLimit?: string}

const exportParams = [
  'name: Minecraft nickname or Twitch name',
  'uuid: player UUID',
  'from: inclusive UTC date YYYY-MM-DD (1970-01-01)',
  'to: exclusive UTC date YYYY-MM-DD (tomorrow)',
  'mode: daily or records (daily)',
  'format: json or csv (json)',
  'limit: records only (1000, max 5000)',
  'cursor: records only',
]
const exportReturns = 'Daily totals or paginated records, as JSON or CSV.'
const exportRateLimit = '6 requests/minute; 2 concurrent exports per endpoint.'

const endpoints: Endpoint[] = [
  {path: 'getLeaderboard', params: ['days: 1, 7, 30, or 9999 (30)', 'category (nether)', 'type: qty, average, fastest, or conversion (qty)', 'limit (10, max 999999)'], returns: 'Array of leaderboard entries.'},
  {path: 'getFastest', params: ['days: 1, 7, 30, or 9999 (30)', 'category (nether)', 'limit (10, max 999999)'], returns: 'Array of fastest-run entries.'},
  {path: 'getWorld', params: ['worldId (required)'], returns: '{ data, time, isLive } or null.'},
  {path: 'getRecentRuns', params: ['name', 'hours (lifetime by default)', 'hoursBetween (lifetime by default)', 'limit (10, maximum 1000)'], returns: 'Array of pace runs.'},
  {path: 'getRecentTimestamps', params: ['name', 'limit (20, max 50)', 'onlyFort (false)'], returns: 'Array of timestamp/split records.'},
  {path: 'getLatestRun', params: ['name', 'forceName (false)'], returns: 'One run object, [] when none, or { error: "Unknown user" }.'},
  {path: 'getLatestCompletion', params: ['name'], returns: 'Array containing the latest completion, [] when none, or { error: "Unknown user" }.'},
  {path: 'getPBs', params: ['names: comma-separated names (optional)', 'uuids: comma-separated UUIDs (optional)'], returns: 'Array of PB records.'},
  {path: 'getNickAlways', params: ['uuid'], returns: '{ name }.'},
  {path: 'getAllUsers', returns: 'Array of user records.'},
  {path: 'getRunsPaginated', params: ['page (1)', 'pageSize (10000, maximum 10000)'], returns: '{ pageCount, runs }, or { error, pageCount, runs }.', rateLimit: '12 requests/minute.'},
  {path: 'getSessionStats', params: ['name', 'hours (24)', 'hoursBetween (6)'], returns: 'Object keyed by nether, bastion, fortress, first_structure, second_structure, first_portal, stronghold, end, and finish.'},
  {path: 'getSessionNethers', params: ['name', 'hours (24)', 'hoursBetween (6)', 'liveOnly (false)', 'dp (0–3)'], returns: '{ count, avg, rnph, uuid }.'},
  {path: 'getSplitStats', params: ['name', 'hours (24)', 'hoursBetween (6)', 'split (nether)', 'maxTime (99999999)'], returns: '{ count, avg, ms }.'},
  {path: 'getCombinedStats', params: ['names: at most 20 comma-separated names', 'hours (24)', 'hoursBetween (6)', 'start (0)'], returns: 'Object keyed by split, each containing count and avg.', rateLimit: '30 requests/minute (shared).'},
  {path: 'getCombinedNethers', params: ['names: at most 20 comma-separated names', 'hours (24)', 'hoursBetween (6)', 'start (0)', 'maxTime (99999999)'], returns: '{ count, avg }.', rateLimit: '30 requests/minute (shared).'},
  {path: 'getNPH', params: ['name', 'hours (24)', 'hoursBetween (2)', 'liveOnly (false)'], returns: 'NPH statistics object.'},
  {path: 'exportStats', params: exportParams, returns: exportReturns, rateLimit: exportRateLimit, notes: 'Provide exactly one of name or uuid.'},
  {path: 'exportResetStats', params: exportParams, returns: exportReturns, rateLimit: exportRateLimit, notes: 'Provide exactly one of name or uuid.'},
  {path: 'searchPlayers', params: ['q: at least 2 characters', 'limit (8, max 20)'], returns: 'Array of { id, name, displayName, color, bgColor }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getPlayerRuns', params: ['uuid', 'beforeId: exclusive cursor (cursor pagination)', 'limit: cursor page size (25, max 100)', 'page: zero-based page (offset pagination)', 'pageSize: 10, 25, 50, or 100 (25, offset pagination)', 'filters: optional JSON array (offset pagination)'], returns: 'Cursor mode: { rows, nextCursor, hasMore, loadedCount }. Page mode: { rows, rowCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: 'getAAPlayerRuns', params: ['uuid', 'beforeId: exclusive cursor', 'limit (25, max 100)'], returns: '{ rows, nextCursor, hasMore, loadedCount }.', rateLimit: '120 requests per 60 seconds per client IP.'},
  {path: '../aa/api/getAllData', params: ['days: 1, 7, 30, or 9999 (30)'], returns: '{ data: [...] }.', notes: 'This route is prefixed with /stats/aa/api/, not /stats/api/.'},
]

function EndpointBlock({endpoint}: {endpoint: Endpoint}) {
  const example = apiExamples[endpoint.path];
  const url = exampleRequestUrl(endpoint.path);
  const preview = exampleResponsePreview(example.response);

  return <section className="apiBlock" id={endpoint.path.replaceAll('/', '-')}>
    <h3><code>GET /{endpoint.path}</code></h3>
    {endpoint.params && <div className="apiParameterRow">
      <b>Parameters:</b>
      <ul className="apiParams">{endpoint.params.map(param => <li key={param}>{param}</li>)}</ul>
    </div>}
    <p><b>Response:</b> <code>{endpoint.returns}</code></p>
    {endpoint.rateLimit && <p><b>Rate limit:</b> {endpoint.rateLimit}</p>}
    {endpoint.notes && <p><b>Note:</b> {endpoint.notes}</p>}
    <p><b>Example URL:</b> <a className="apiExampleUrl" href={url}><code>{url}</code></a></p>
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
