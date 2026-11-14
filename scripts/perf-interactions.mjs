/** Local Docker first-open cost for the run-history filters. */
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5071/stats/');
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Local Docker URL required');
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/round2/filter-interactions.json';
await mkdir(dirname(output), {recursive: true});
const require = createRequire('/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const results = [];
const errors = [];
try {
    for (let sample = 0; sample < 3; sample++) {
        const context = await browser.newContext({viewport: {width: 1365, height: 900}});
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.origin === base.origin) return route.continue();
            if (route.request().resourceType() === 'image') return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>'});
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        const client = await context.newCDPSession(page);
        await client.send('Network.enable');
        await client.send('Performance.enable');
        await client.send('Network.emulateNetworkConditions', {offline: false, latency: 300, downloadThroughput: 10_000_000 / 8, uploadThroughput: 5_000_000 / 8});
        await client.send('Emulation.setCPUThrottlingRate', {rate: 4});
        await page.addInitScript(() => {
            window.__tasks = [];
            new PerformanceObserver(list => window.__tasks.push(...list.getEntries().map(entry => entry.duration))).observe({type: 'longtask', buffered: true});
        });
        await page.goto(new URL('player/NoFearr1337/runs/', base).href, {waitUntil: 'networkidle'});
        await page.waitForFunction(() => {
            const button = document.querySelector('.filterToggle');
            return button && Object.keys(button).some(key => key.startsWith('__reactProps$'));
        });
        const before = await page.evaluate(() => ({resources: performance.getEntriesByType('resource').length, tasks: window.__tasks.length}));
        const started = performance.now();
        await page.getByRole('button', {name: 'Filters', exact: true}).click();
        await page.getByRole('button', {name: 'Sub 2 Enter', exact: true}).waitFor();
        const readyMs = performance.now() - started;
        const observation = await page.evaluate(before => {
            const resources = performance.getEntriesByType('resource').slice(before.resources);
            return {
                localRequests: resources.length,
                decodedBytes: resources.reduce((total, entry) => total + entry.decodedBodySize, 0),
                scriptBytes: resources.filter(entry => entry.initiatorType === 'script').reduce((total, entry) => total + entry.decodedBodySize, 0),
                longTaskMs: window.__tasks.slice(before.tasks).reduce((total, value) => total + value, 0),
            };
        }, before);
        const metrics = (await client.send('Performance.getMetrics')).metrics;
        const heapMiB = (metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? 0) / 1048576;
        results.push({sample: sample + 1, readyMs, ...observation, heapMiB});
        if (sample === 2) {
            // Capture the finished collapse animation for visual review.
            // This delay is outside all reported measurements.
            await page.waitForTimeout(400);
            await page.screenshot({path: output.replace(/\.json$/, '.png'), fullPage: true});
        }
        await context.close();
    }
    if (errors.length) throw new Error(JSON.stringify(errors));
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify({base: base.href, latencyMs: 300, cpuSlowdown: 4, results, errors}, null, 2));
    console.log(JSON.stringify(results));
} finally {
    await browser.close();
}
