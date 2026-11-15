/** Local production pair: cold-browser header theme readiness, not cold MySQL. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'), 'Use the local Docker environment');
const servers = [process.env.PERF_BASELINE_URL ?? 'http://127.0.0.1:5121/stats/',
    process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5122/stats/'].map(url => new URL(url));
for (const server of servers) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(server.hostname));
const rounds = Number(process.env.PERF_ROUNDS ?? 3);
assert.ok(Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 10);
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/cold2/identity-timing.json';
const cases = [
    {path: 'player/COVlD19/aa/', heading: 'AA Stats for jojoe77777'},
    {path: 'player/COVlD19/runs/aa/', heading: 'Recent AA runs for jojoe77777'},
    {path: 'player/COVlD19/session/', heading: 'Session stats for jojoe77777'},
    {path: 'player/COVlD19/nethers/', heading: 'Recent NPH tracker data for jojoe77777'},
];
// Read-only fixture confirmation: local COVlD19 color is4287f5. The existing
// getUserColours conversion multiplies RGB by0.95, then text by0.05.
const expectedTheme = {backgroundColor: 'rgb(63, 128, 233)', color: 'rgb(3, 6, 12)'};
const {chromium} = createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const results = [], errors = [];
const rounded = value => Math.round(value * 10) / 10;
try {
    for (let round = 0; round < rounds; round++) for (const item of cases) {
        for (const index of round % 2 ? [1, 0] : [0, 1]) {
            const base = servers[index], context = await browser.newContext({viewport: {width: 1365, height: 900}});
            try {
                await context.route('**/*', route => {
                    const request = route.request();
                    const url = new URL(request.url());
                    if (url.pathname.includes('/_next/image') && /^https?:/.test(url.searchParams.get('url') ?? '')) {
                        return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
                    }
                    if (url.origin === base.origin) return route.continue();
                    if (request.resourceType() === 'image') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
                    return route.abort();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(45_000);
                const identityRequests = [];
                page.on('request', request => {
                    if (new URL(request.url()).pathname === '/stats/api/getPlayerInfo/') identityRequests.push(request.url());
                });
                page.on('pageerror', error => errors.push({round, index, path: item.path, error: error.message}));
                const cdp = await context.newCDPSession(page);
                await cdp.send('Network.enable');
                await cdp.send('Network.emulateNetworkConditions', {offline: false, latency: 300,
                    downloadThroughput: 1_250_000, uploadThroughput: 625_000});
                await cdp.send('Emulation.setCPUThrottlingRate', {rate: 4});
                await page.addInitScript(({heading, expectedTheme}) => {
                    const timing = window.__identityTiming = {contentMs: null, headerHydratedMs: null, themedHeaderMs: null, tasks: []};
                    new PerformanceObserver(list => timing.tasks.push(...list.getEntries().map(entry => ({startMs: entry.startTime, durationMs: entry.duration}))))
                        .observe({type: 'longtask', buffered: true});
                    const check = () => {
                        const now = performance.now();
                        if (timing.contentMs === null && document.querySelector('main h1')?.textContent.trim() === heading) timing.contentMs = now;
                        const brand = document.querySelector('.navbar-brand'), nav = brand?.closest('nav');
                        const hydrated = brand && Object.keys(brand).some(key => key.startsWith('__reactProps$'));
                        if (hydrated && timing.headerHydratedMs === null) timing.headerHydratedMs = now;
                        if (hydrated && nav && !nav.classList.contains('navbar-dark')) {
                            const background = getComputedStyle(nav).backgroundColor;
                            const foreground = getComputedStyle(brand).color;
                            if (background === expectedTheme.backgroundColor && foreground === expectedTheme.color) {
                                timing.themedHeaderMs = now;
                                return;
                            }
                        }
                        requestAnimationFrame(check);
                    };
                    requestAnimationFrame(check);
                }, {heading: item.heading, expectedTheme});
                const response = await page.goto(new URL(item.path, base).href, {waitUntil: 'domcontentloaded'});
                assert.equal(response.status(), 200, item.path);
                await page.waitForFunction(() => window.__identityTiming?.themedHeaderMs !== null && window.__identityTiming?.contentMs !== null);
                await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
                const metrics = await page.evaluate(() => {
                    const navigation = performance.getEntriesByType('navigation')[0];
                    const resources = performance.getEntriesByType('resource')
                        .filter(entry => new URL(entry.name).origin === location.origin)
                        .map(entry => ({path: new URL(entry.name).pathname, query: new URL(entry.name).search,
                            startMs: entry.startTime, durationMs: entry.duration, bytes: entry.decodedBodySize, initiator: entry.initiatorType}));
                    return {...window.__identityTiming, documentBytes: navigation.decodedBodySize,
                        ttfbMs: navigation.responseStart - navigation.requestStart, resources};
                });
                assert.equal(identityRequests.length, index ? 0 : 1, `${item.path}: actual header identity API requests`);
                const tasks = metrics.tasks.filter(task => task.startMs <= metrics.themedHeaderMs);
                const result = {round, kind: index ? 'final' : 'baseline', path: item.path,
                    ...metrics, identityRequests: identityRequests.length, headerTheme: expectedTheme,
                    longTaskMs: tasks.reduce((total, task) => total + task.durationMs, 0),
                    maxLongTaskMs: Math.max(0, ...tasks.map(task => task.durationMs))};
                results.push(result);
                console.log(JSON.stringify({...result, resources: undefined, tasks: undefined}));
            } finally {await context.close();}
        }
    }
    assert.deepEqual(errors, []);
} finally {await browser.close();}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = cases.map(item => ({path: item.path, ...Object.fromEntries(['baseline', 'final'].map(kind => {
    const rows = results.filter(row => row.path === item.path && row.kind === kind);
    return [kind, Object.fromEntries(['contentMs', 'headerHydratedMs', 'themedHeaderMs', 'identityRequests', 'ttfbMs', 'longTaskMs', 'maxLongTaskMs']
        .map(field => [field, rounded(median(rows.map(row => row[field])))]))];
}))}));
await mkdir(dirname(output), {recursive: true});
await writeFile(output, `${JSON.stringify({method: 'Fresh Chromium contexts,300msHTTP,4xCPU,10/5Mbps,identical local upstream stubs,alternating revision order. The themed header is the first animation frame with hydrated navigation and exact existing custom colors. Server/Redis/MySQL/OS caches are not cleared. This is header readiness,not a whole-page or cold-database benchmark.', rounds, expectedTheme, results, summary, errors}, null, 2)}\n`);
console.log(JSON.stringify({output, summary}));
