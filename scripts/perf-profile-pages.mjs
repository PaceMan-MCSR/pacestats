/** Paired cold-browser probes for profile, tracker and OBS, inside local Docker. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
const servers=[process.env.PERF_BASELINE_URL,process.env.PERF_BASE_URL].map(value=>new URL(value));
for(const server of servers)assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname));
const output=process.env.PERF_OUTPUT??'/app/test-artifacts/performance/round4/profile-pages.json';
await mkdir(dirname(output),{recursive:true});
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[],errors=[];
try {
    for(let round=0;round<3;round++)for(const path of ['player/CroProYT/aa/','player/NoFearr1337/nethers/','obs/'])for(const index of round%2?[1,0]:[0,1]){
        const base=servers[index],context=await browser.newContext({viewport:{width:1365,height:900}});
        try {
            await context.route('**/*',route=>{
                const request=route.request(),url=new URL(request.url());
                if(url.origin===base.origin)return route.continue();
                if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                return route.abort();
            });
            const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
            const cdp=await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1250000,uploadThroughput:625000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            await page.addInitScript(()=>{
                window.tasks=[];window.lcp=0;
                new PerformanceObserver(list=>list.getEntries().forEach(entry=>window.tasks.push(entry.duration))).observe({type:'longtask',buffered:true});
                new PerformanceObserver(list=>list.getEntries().forEach(entry=>window.lcp=entry.startTime)).observe({type:'largest-contentful-paint',buffered:true});
            });
            const started=performance.now();assert.equal((await page.goto(new URL(path,base).href,{waitUntil:'domcontentloaded'})).status(),200);
            await page.waitForFunction(isObs=>{
                const element=document.querySelector(isObs?'.obsSetup .nameSearch input':'table tbody tr');
                return element&&Object.keys(element).some(key=>key.startsWith('__reactProps$'))&&(!isObs||document.querySelector('.colorPickerInput input'));
            },path==='obs/');
            const readyMs=performance.now()-started;
            await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
            const metrics=await page.evaluate(()=>({documentBytes:performance.getEntriesByType('navigation')[0].decodedBodySize,
                scriptBytes:performance.getEntriesByType('resource').filter(entry=>entry.initiatorType==='script').reduce((sum,entry)=>sum+entry.decodedBodySize,0),
                longTaskMs:window.tasks.reduce((sum,duration)=>sum+duration,0),maxLongTaskMs:Math.max(0,...window.tasks),lcpMs:window.lcp}));
            const row={round,kind:index?'final':'baseline',path,readyMs:Math.round(readyMs*10)/10,...metrics};results.push(row);console.log(JSON.stringify(row));
            if(round===2&&index===1)await page.screenshot({path:`${dirname(output)}/${path==='obs/'?'obs':path.includes('nethers')?'tracker':'aa-profile'}.png`});
        }finally{await context.close();}
    }
    assert.deepEqual(errors,[]);
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    const summary=[...new Set(results.map(row=>row.path))].map(path=>{
        const row={path};for(const field of ['readyMs','documentBytes','scriptBytes','longTaskMs','maxLongTaskMs','lcpMs'])for(const kind of ['baseline','final'])row[`${kind}_${field}`]=median(results.filter(value=>value.path===path&&value.kind===kind).map(value=>value[field]));return row;
    });
    await writeFile(output,JSON.stringify({method:{latencyMs:300,cpuRate:4,samplesPerRevision:3},results,summary,errors},null,2));
    console.log(JSON.stringify({summary}));
}finally{await browser.close();}
