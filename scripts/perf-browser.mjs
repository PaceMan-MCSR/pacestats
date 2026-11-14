/** Local Docker browser benchmark. See scripts/PERFORMANCE.md. */
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5051/stats/');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
    throw new Error('This benchmark only targets a local Docker server.');
}
const require = createRequire(process.env.PERF_PLAYWRIGHT_PACKAGE ?? '/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const latency = Number(process.env.PERF_LATENCY_MS ?? 300);
const cpuRate = Number(process.env.PERF_CPU_RATE ?? 4);
const player = process.env.PERF_PLAYER ?? 'NoFearr1337';
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/browser.json';
await mkdir(dirname(output), {recursive: true});
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const context = await browser.newContext({viewport: {width: 1365, height: 900}});
// Keep third-party availability out of comparisons, and never contact production APIs.
await context.route('**/*', async route => {
    const requestUrl = new URL(route.request().url());
    const proxiedImage = requestUrl.pathname.includes('/_next/image') ? requestUrl.searchParams.get('url') : null;
    if (proxiedImage && /^https?:\/\//.test(proxiedImage)) {
        return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>'});
    }
    if (requestUrl.origin === base.origin) return route.continue();
    if (route.request().resourceType() === 'image') {
        return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'});
    }
    return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
const client = await context.newCDPSession(page);
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
    offline: false, latency, downloadThroughput: 10_000_000 / 8, uploadThroughput: 5_000_000 / 8,
});
await client.send('Emulation.setCPUThrottlingRate', {rate: cpuRate});
await client.send('Performance.enable');
await page.addInitScript(() => {
    window.__perfTasks = [];
    new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__perfTasks.push({start: entry.startTime, duration: entry.duration});
    }).observe({type: 'longtask', buffered: true});
    window.__perfLcp = 0;
    new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__perfLcp = entry.startTime;
    }).observe({type: 'largest-contentful-paint', buffered: true});
});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
    if (response.status() >= 400 && new URL(response.url()).origin === base.origin) {
        errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
});
const results = [];
const number = value => Math.round(value * 10) / 10;
async function measure(name, action, ready, interactive) {
    const before = await page.evaluate(() => performance.timeOrigin);
    const tasksBefore = await page.evaluate(() => window.__perfTasks?.length ?? 0);
    const resourcesBefore = await page.evaluate(() => performance.getEntriesByType('resource').length);
    const started = performance.now();
    await action();
    await ready();
    const readyMs = performance.now() - started;
    // Allow the final render to paint; avoids treating URL mutation as content readiness.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const observation = await page.evaluate(({tasksBefore, resourcesBefore, before}) => {
        const resources = performance.getEntriesByType('resource');
        const freshDocument = performance.timeOrigin !== before;
        const navigation = performance.getEntriesByType('navigation')[0];
        const tasks = (window.__perfTasks ?? []).slice(freshDocument ? 0 : tasksBefore);
        const entries = resources.slice(freshDocument ? 0 : resourcesBefore).filter(item => new URL(item.name).origin === location.origin);
        return {
            documentBytes: freshDocument ? navigation?.decodedBodySize ?? 0 : 0,
            documentTtfbMs: freshDocument && navigation ? navigation.responseStart - navigation.requestStart : null,
            longTaskMs: tasks.reduce((sum, task) => sum + task.duration, 0),
            maxLongTaskMs: Math.max(0, ...tasks.map(task => task.duration)),
            localRequests: entries.length,
            decodedBytes: entries.reduce((sum, item) => sum + item.decodedBodySize, 0),
            scriptBytes: entries.filter(item => item.initiatorType === 'script').reduce((sum, item) => sum + item.decodedBodySize, 0),
            lcpMs: freshDocument ? window.__perfLcp : null,
        };
    }, {tasksBefore, resourcesBefore, before});
    const metrics = (await client.send('Performance.getMetrics')).metrics;
    const heap = metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? 0;
    const result = {name, readyMs: number(readyMs), ...observation, browserHeapMiB: number(heap / 1048576)};
    if (interactive) {
        await interactive();
        result.interactiveMs = number(performance.now() - started);
    }
    results.push(result);
    console.log(JSON.stringify(result));
}
const url = path => new URL(path, base).href;
const boardReady = async () => {
    // The imported dump can legitimately have no runs in its 24-hour window.
    await page.locator('.stats-row:not([aria-busy="true"])').first().waitFor({state: 'attached', timeout: 60_000});
    await page.locator('.rangeButtons button').first().waitFor();
    await page.waitForFunction(() => {
        const button = document.querySelector('.rangeButtons button');
        const link = document.querySelector('.boardLink');
        const hydrated = element => element && Object.keys(element).some(key => key.startsWith('__reactProps$'));
        return hydrated(button) && (!link || hydrated(link));
    });
};
const profileReady = async () => {
    await page.locator('.playerStats .stat').first().waitFor({timeout: 60_000});
    await page.waitForFunction(() => {
        const button = document.querySelector('.rangeButtons button');
        return button && Object.keys(button).some(key => key.startsWith('__reactProps$'));
    });
};
async function changeRange(days, label, ready, scope) {
    await measure(`${scope}: ${label}`, async () => {
        await page.getByRole('button', {name: label, exact: true}).click();
    }, async () => {
        await page.waitForURL(current => current.searchParams.get('days') === String(days), {waitUntil: 'domcontentloaded'});
        await page.locator('.rangeButtons button:disabled').waitFor({state: 'detached'});
        await ready();
    });
}
try {
    await measure('front: cold browser', () => page.goto(base.href, {waitUntil: 'domcontentloaded'}), boardReady);
    // A real interaction also verifies that server-rendered controls hydrated.
    for (const [days, label] of [[1, '24 hours'], [7, '7 days'], [30, '30 days'], [9999, 'Lifetime'], [7, '7 days']]) {
        await changeRange(days, label, boardReady, 'front');
    }
    await measure('profile: first navigation', async () => {
        // Use an actual leaderboard link when available; direct router navigation otherwise.
        const link = page.locator(`a[href="/stats/player/${player}/"]`).first();
        if (await link.count()) await link.click();
        else await page.goto(url(`player/${player}/`), {waitUntil: 'domcontentloaded'});
    }, profileReady);
    for (const [days, label] of [[1, '24 hours'], [7, '7 days'], [30, '30 days'], [9999, 'Lifetime']]) {
        await changeRange(days, label, profileReady, 'profile');
    }
    await measure('profile: more runs', () => page.getByRole('button', {name: 'More runs', exact: true}).click(), async () => {
        await page.waitForURL(/\/runs\//);
        await page.locator('.fastRunsPageRange').waitFor({timeout: 60_000});
    });
    await measure('runs: next page', () => page.getByRole('button', {name: 'Go to next page'}).click(), async () => {
        await page.locator('.fastRunsPageRange').filter({hasText: /^26/}).waitFor({timeout: 60_000});
    });
    await page.goto(url(`player/${player}/`), {waitUntil: 'domcontentloaded'});
    await profileReady();
    await measure('profile: recent run detail', () => page.locator('.recentRuns tbody tr').first().click(), async () => {
        await page.waitForURL(/\/run\//);
        await page.locator('.run-card').first().waitFor({timeout: 60_000});
        await page.getByText('Loading...', {exact: true}).waitFor({state: 'detached'});
    }, async () => {
        // Seeded run content can paint before hydration. Record both, and
        // finish hydration before beginning an unrelated next navigation.
        await page.waitForFunction(() => {
            const card = document.querySelector('.run-card');
            return card && Object.keys(card).some(key => key.startsWith('__reactProps$'));
        });
    });
    await page.goBack();
    await profileReady();
    await measure('profile: tracker history', () => page.getByRole('button', {name: 'Debug', exact: true}).click(), async () => {
        await page.waitForURL(/\/nethers\//);
        await page.locator('.recentNethers tbody tr').first().waitFor({timeout: 60_000});
        await page.waitForFunction(() => {
            const row = document.querySelector('.recentNethers tbody tr');
            return row && Object.keys(row).some(key => key.startsWith('__reactProps$'));
        });
    });
    await page.screenshot({path: output.replace(/\.json$/, '.png'), fullPage: false});
} finally {
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify({
        generatedAt: new Date().toISOString(), baseUrl: base.href, latencyMs: latency,
        cpuSlowdown: cpuRate, downloadMbps: 10, uploadMbps: 5,
        thirdParty: 'Images stubbed; external APIs and telemetry blocked in browser',
        playwright: require('playwright/package.json').version, results, errors,
    }, null, 2));
    await browser.close();
}
if (errors.length) throw new Error(`Browser errors: ${errors.join('; ')}`);
