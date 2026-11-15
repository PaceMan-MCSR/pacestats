/** Local Docker cold-page request/bundle probe; run timing separately from builds. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'), 'Run inside local Docker');
const servers = [process.env.PERF_BASELINE_URL, process.env.PERF_BASE_URL].filter(Boolean).map(value => new URL(value));
assert.ok(servers.length);
for (const server of servers) assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname));
const rounds = Number(process.env.PERF_ROUNDS ?? 3);
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/bundles/pages.json';
const cases = [
    {path:'', content:'.stats-row:not([aria-busy="true"])', interactive:'.rangeButtons button'},
    {path:'player/NoFearr1337/', content:'.playerStats .stat', interactive:'.rangeButtons button'},
    {path:'player/NoFearr1337/runs/', content:'.fastRunsPageRange', interactive:'.fastRunsPageRange'},
    {path:'player/CroProYT/runs/aa/', content:'.recentRunsFull tbody tr', interactive:'.recentRunsFull tbody tr'},
    {path:'obs/', content:'.obsSetup', interactive:'.colorPickerInput input'},
    {path:'api/', content:'.apiBlock', interactive:'.searchWrapper input'},
];
const {chromium} = createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const results = [], errors = [];
const rounded = value => Math.round(value * 10) / 10;
try {
    for (let round = 0; round < rounds; round++) for (const item of cases) {
        const order = servers.map((_, index) => index);
        if (round % 2) order.reverse();
        for (const index of order) {
            const base = servers[index], context = await browser.newContext({viewport:{width:1365,height:900}});
            try {
                await context.route('**/*', route => {
                    const request = route.request(), url = new URL(request.url());
                    if (url.pathname.includes('/_next/image') && /^https?:/.test(url.searchParams.get('url') ?? '')) {
                        return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                    }
                    if (url.origin === base.origin) return route.continue();
                    if (request.resourceType() === 'image') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                    return route.abort();
                });
                const page = await context.newPage();
                page.setDefaultTimeout(60_000);
                page.on('pageerror', error => errors.push({path:item.path,error:error.message}));
                const cdp = await context.newCDPSession(page);
                const initiators = new Map();
                await cdp.send('Network.enable');
                cdp.on('Network.requestWillBeSent', event => {
                    const url = new URL(event.request.url);
                    if (url.origin === base.origin) initiators.set(url.href, {type:event.initiator.type,
                        parent:event.initiator.stack?.callFrames.find(frame=>frame.url)?.url.replace(base.origin,'')});
                });
                await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1_250_000,uploadThroughput:625_000});
                await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
                await page.addInitScript(() => {
                    window.bundleTasks = []; window.bundleLcp = 0;
                    new PerformanceObserver(list => list.getEntries().forEach(entry => window.bundleTasks.push(entry.duration))).observe({type:'longtask',buffered:true});
                    new PerformanceObserver(list => list.getEntries().forEach(entry => {window.bundleLcp = entry.startTime;})).observe({type:'largest-contentful-paint',buffered:true});
                });
                const start = performance.now();
                const response = await page.goto(new URL(item.path,base).href,{waitUntil:'domcontentloaded'});
                assert.equal(response.status(),200,item.path);
                await page.locator(item.content).first().waitFor({state:'visible'});
                const contentMs = performance.now() - start;
                await page.waitForFunction(selector => {
                    const element = document.querySelector(selector);
                    return element && !element.disabled && Object.keys(element).some(key => key.startsWith('__reactProps$'));
                },item.interactive);
                const interactiveMs = performance.now() - start;
                await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
                const metrics = await page.evaluate(() => {
                    const navigation = performance.getEntriesByType('navigation')[0];
                    const resources = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).origin === location.origin)
                        .map(entry=>({path:new URL(entry.name).pathname,query:new URL(entry.name).search,
                            startMs:entry.startTime,durationMs:entry.duration,bytes:entry.decodedBodySize,
                            type:entry.initiatorType,blocking:entry.renderBlockingStatus}));
                    return {documentBytes:navigation.decodedBodySize,ttfbMs:navigation.responseStart-navigation.requestStart,
                        inlineStyleBytes:[...document.querySelectorAll('style')].reduce((sum,style)=>sum+new TextEncoder().encode(style.textContent).length,0),
                        scriptBytes:resources.filter(entry=>/\.js$/.test(entry.path)).reduce((sum,entry)=>sum+entry.bytes,0),
                        localRequests:resources.length,blockingRequests:resources.filter(entry=>entry.blocking==='blocking').length,
                        longTaskMs:window.bundleTasks.reduce((sum,duration)=>sum+duration,0),maxLongTaskMs:Math.max(0,...window.bundleTasks),
                        lcpMs:window.bundleLcp,resources};
                });
                for (const resource of metrics.resources) resource.initiator = initiators.get(new URL(resource.path+resource.query,base).href);
                const row = {round,kind:index?'final':'baseline',path:item.path,contentMs:rounded(contentMs),interactiveMs:rounded(interactiveMs),...metrics};
                results.push(row);
                console.log(JSON.stringify({...row,resources:undefined}));
            } finally {await context.close();}
        }
    }
    assert.deepEqual(errors,[]);
    const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const summary = cases.map(item => {
        const row = {path:item.path};
        for (const kind of ['baseline','final']) {
            const selected = results.filter(result=>result.path===item.path && result.kind===kind);
            if (!selected.length) continue;
            row[kind] = Object.fromEntries(['contentMs','interactiveMs','documentBytes','inlineStyleBytes','scriptBytes','localRequests','blockingRequests','longTaskMs','maxLongTaskMs','lcpMs']
                .map(field=>[field,rounded(median(selected.map(result=>result[field])))]));
        }
        return row;
    });
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({method:{latencyMs:300,cpuSlowdown:4,downloadMbps:10,uploadMbps:5,rounds,
        note:'Fresh browser contexts, local production Next servers, external requests blocked/images stubbed. Assets observed at initial interactivity, not all later idle downloads. Direct Next HTTP is uncompressed; decoded sizes are not production compressed transfer sizes.'},results,summary,errors},null,2));
    console.log(JSON.stringify({summary}));
} finally {await browser.close();}
