/** Paired local Docker AA cold-browser measurements, with the main navigation throttle. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
const servers = [process.env.PERF_BASELINE_URL,process.env.PERF_BASE_URL].map(value => new URL(value));
for(const server of servers) assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname),'Local Docker URL required');
const {chromium} = createRequire('/tmp/pacestats-perf/package.json')('playwright');
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/round3/aa-browser.json';
await mkdir(dirname(output),{recursive:true});
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
const results = [], errors = [];
try {
    for(let round=0;round<3;round++) for(const days of [30,9999]) for(const index of round%2 ? [1,0]:[0,1]) {
        const base = servers[index], context = await browser.newContext({viewport:{width:1365,height:900}});
        try {
            await context.route('**/*',route => {
                const request = route.request(), url = new URL(request.url());
                if(url.origin === base.origin) return route.continue();
                if(request.resourceType()==='image') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                return route.abort();
            });
            const page = await context.newPage();
            page.on('pageerror',error => errors.push(error.message));
            const cdp = await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1250000,uploadThroughput:625000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            await page.addInitScript(() => {
                window.tasks = []; window.lcp = 0;
                new PerformanceObserver(list => list.getEntries().forEach(entry => window.tasks.push(entry.duration))).observe({type:'longtask',buffered:true});
                new PerformanceObserver(list => list.getEntries().forEach(entry => window.lcp=entry.startTime)).observe({type:'largest-contentful-paint',buffered:true});
            });
            const start = performance.now();
            const response = await page.goto(new URL(`aa/?days=${days}`,base).href,{waitUntil:'domcontentloaded'});
            assert.equal(response.status(),200);
            await page.waitForFunction(() => {
                const control = document.querySelector('.rangeButtons button');
                const link = document.querySelector('.stats-row .boardLink');
                return control && link && [control,link].every(element => Object.keys(element).some(key => key.startsWith('__reactProps$')));
            });
            const readyMs = performance.now()-start;
            await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
            const metrics = await page.evaluate(() => ({documentBytes:performance.getEntriesByType('navigation')[0].decodedBodySize,
                scriptBytes:performance.getEntriesByType('resource').filter(entry => entry.initiatorType==='script').reduce((sum,entry)=>sum+entry.decodedBodySize,0),
                longTaskMs:window.tasks.reduce((sum,duration)=>sum+duration,0),maxLongTaskMs:Math.max(0,...window.tasks),lcpMs:window.lcp}));
            const result = {round,kind:index ? 'final':'baseline',days,readyMs:Math.round(readyMs*10)/10,...metrics};
            results.push(result); console.log(JSON.stringify(result));
            if(round===2 && index===1) await page.screenshot({path:`${dirname(output)}/aa-${days}.png`});
        } finally {await context.close();}
    }
    assert.deepEqual(errors,[]);
    const median = values => values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const summary = [30,9999].map(days => ({days,...Object.fromEntries(['baseline','final'].map(kind => {
        const samples = results.filter(result => result.days===days && result.kind===kind);
        return [kind,Object.fromEntries(['readyMs','documentBytes','scriptBytes','longTaskMs','maxLongTaskMs','lcpMs'].map(key=>[key,median(samples.map(value=>value[key]))]))];
    }))}));
    await writeFile(output,JSON.stringify({latencyMs:300,cpuSlowdown:4,results,summary,errors},null,2));
} finally {await browser.close();}
