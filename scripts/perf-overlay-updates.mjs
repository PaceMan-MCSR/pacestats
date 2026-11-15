/** Local production OBS data-delivery probe, with explicit socket downlink delay. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {existsSync} from 'node:fs';
import Redis from 'ioredis';
assert.ok(existsSync('/.dockerenv'), 'Run inside local Docker');
const servers=[process.env.PERF_BASELINE_URL,process.env.PERF_BASE_URL].map(value=>new URL(value));
for(const server of servers)assert.ok(['127.0.0.1','localhost','[::1]'].includes(server.hostname));
const channel=process.env.PERF_WS_CHANNEL;
assert.ok(channel?.startsWith('pacestats:obs-perf-'), 'Use an isolated local Pub/Sub channel');
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const redis=new Redis(process.env.REDIS_URL),results=[],errors=[];
const output=process.env.PERF_OUTPUT??'/app/test-artifacts/performance/obs-live/update-delivery.json';
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
try {
    for(let round=0;round<3;round++)for(const index of round%2?[1,0]:[0,1]){
        const kind=index?'final':'baseline',base=servers[index],context=await browser.newContext({viewport:{width:1280,height:720}});
        try {
            await context.route('**/*',route=>{
                const request=route.request(),url=new URL(request.url());
                if(url.origin===base.origin)return route.continue();
                if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                return route.abort();
            });
            // CDP HTTP throttling alone is not a socket-frame latency model.
            // Relay real backend frames with a controlled150ms downlink delay.
            const timers=new Set();
            await context.routeWebSocket(/ws:\/\/127\.0\.0\.1:809[12]\//,route=>{
                const upstream=route.connectToServer();
                upstream.onMessage(message=>{
                    const timer=setTimeout(()=>{timers.delete(timer);try{route.send(message);}catch{}},150);
                    timers.add(timer);
                });
            });
            const page=await context.newPage();
            page.on('pageerror',error=>errors.push(error.message));
            const cdp=await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1250000,uploadThroughput:625000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            await page.addInitScript(()=>{
                window.overlaySockets=[];window.overlayApiTimes=[];window.overlaySnapshotTimes=[];
                const NativeSocket=window.WebSocket;
                window.WebSocket=class extends NativeSocket {
                    constructor(...args){super(...args);window.overlaySockets.push(this);this.addEventListener('message',event=>{
                        try{if(JSON.parse(event.data)?.type==='snapshot')window.overlaySnapshotTimes.push(performance.now());}catch{}
                    });}
                };
                const original=window.fetch;
                window.fetch=async(...args)=>{
                    const response=await original(...args);
                    if(String(args[0]).includes('/api/getSessionNethers/')){
                        const json=response.json.bind(response);
                        response.json=async()=>{const data=await json();window.overlayApiTimes.push(performance.now());return data;};
                    }
                    return response;
                };
            });
            const begin=performance.now();
            await page.goto(new URL('obs/sessionNethers/NoFearr1337/?hours=239976&hoursBetween=239976&nph=true&color=ffffff',base).href,{waitUntil:'domcontentloaded'});
            await page.waitForFunction(()=>Number(document.querySelector('.sessionNethers h1')?.textContent.trim())>0);
            const initialDataMs=performance.now()-begin;
            await page.waitForFunction(()=>window.overlaySockets.some(socket=>socket.readyState===WebSocket.OPEN));
            const initialDataAndSubscriptionMs=performance.now()-begin;
            const initial=await page.evaluate(()=>({apiRequests:window.overlayApiTimes.length,snapshots:window.overlaySnapshotTimes.length}));
            assert.equal(initial.apiRequests,index?0:1);
            const updates=[];
            for(let event=0;event<3;event++){
                await page.evaluate(()=>{window.overlayApiTimes=[];window.overlaySnapshotTimes=[];window.overlayStart=performance.now();});
                await redis.publish(channel,JSON.stringify({uuid:'e4cd494a-4e0a-423b-9988-618b86858c96'}));
                await page.waitForFunction(final=>(final?window.overlaySnapshotTimes:window.overlayApiTimes).length>0,Boolean(index));
                const update=await page.evaluate(final=>({deliveryMs:(final?window.overlaySnapshotTimes:window.overlayApiTimes)[0]-window.overlayStart,
                    apiRequests:window.overlayApiTimes.length,snapshots:window.overlaySnapshotTimes.length}),Boolean(index));
                assert.equal(update.apiRequests,index?0:1);
                updates.push(update);
            }
            const result={kind,round,initialDataMs:Math.round(initialDataMs*10)/10,
                initialDataAndSubscriptionMs:Math.round(initialDataAndSubscriptionMs*10)/10,initial,updates};
            results.push(result);console.log(JSON.stringify(result));
            if(round===2&&index===1)await page.screenshot({path:output.replace(/\.json$/,'.png'),omitBackground:true});
            for(const timer of timers)clearTimeout(timer);
        }finally{await context.close();}
    }
    assert.deepEqual(errors,[]);
    const summary=['baseline','final'].map(kind=>{
        const selected=results.filter(result=>result.kind===kind),updates=selected.flatMap(result=>result.updates);
        return{kind,initialDataMs:median(selected.map(result=>result.initialDataMs)),
            initialDataAndSubscriptionMs:median(selected.map(result=>result.initialDataAndSubscriptionMs)),deliveryMs:Math.round(median(updates.map(update=>update.deliveryMs))*10)/10,
            apiRequestsPerUpdate:median(updates.map(update=>update.apiRequests)),samples:updates.length};
    });
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({method:{httpLatencyMs:300,socketDownlinkDelayMs:150,cpuSlowdown:4,bandwidthMbps:[10,5],
        note:'Real production components, Next APIs, WS services and SQL. Measures data arrival, not changed-value DOM paint; dataset is static. Isolated Pub/Sub notifications only; no SQL writes.'},results,summary,errors},null,2));
    console.log(JSON.stringify({summary}));
}finally{await browser.close();await redis.quit();}
