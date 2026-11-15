/** Docker-only production SDK, actual route hooks and blocked external ingest. */
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve, dirname} from 'node:path';

assert.ok(existsSync('/.dockerenv'),'Use local Docker');
const origin=new URL(process.env.PERF_BASE_URL??'http://127.0.0.1:5102');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(origin.hostname),'Use a local production service');
const build=process.env.PERF_BUILD_ROOT??'/tmp/pacestats-bundles-final';
const manifest=JSON.parse(readFileSync(`${build}/.next/react-loadable-manifest.json`,'utf8'));
const sdkFiles=new Set(manifest['instrumentation-client.ts -> ./sentry.client.lazy'].files.map(file=>`/stats/_next/${file}`));
const output=resolve(process.env.PERF_OUTPUT??'test-artifacts/performance/bundles/sentry-production.json');
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const waitFor=async(condition,message)=>{
    const deadline=Date.now()+15_000;
    while(!condition()) {if(Date.now()>deadline)throw new Error(message);await delay(20);}
};
async function prepare() {
    const context=await browser.newContext(),sdkRequests=[],envelopes=[],errors=[];
    await context.addInitScript(()=>{
        const early={},removed={error:false,unhandledrejection:false};
        const add=window.addEventListener,remove=window.removeEventListener;
        window.__sentryProductionProbe={loadAt:0,unhandled:[],spans:[],removed};
        // Instrumentation runs before the application bootstrap installs its
        // own error hooks; keep callback identity to observe its removal.
        window.addEventListener=function(type,listener,...args){
            if((type==='error'||type==='unhandledrejection')&&!early[type])early[type]=listener;
            return add.call(this,type,listener,...args);
        };
        window.removeEventListener=function(type,listener,...args){
            if(early[type]===listener)removed[type]=true;
            return remove.call(this,type,listener,...args);
        };
        add.call(window,'load',()=>{window.__sentryProductionProbe.loadAt=Date.now();},{once:true});
        add.call(window,'unhandledrejection',event=>window.__sentryProductionProbe.unhandled.push(String(event.reason)));
    });
    await context.route('**/*',route=>{
        const request=route.request(),url=new URL(request.url());
        if(['localhost','127.0.0.1','[::1]'].includes(url.hostname))return route.continue();
        if(url.hostname.endsWith('sentry.io')&&url.pathname.includes('/envelope/'))envelopes.push(request.postData()??'');
        return route.abort();
    });
    const page=await context.newPage();
    page.on('request',request=>{
        const url=new URL(request.url());
        if(sdkFiles.has(url.pathname))sdkRequests.push({file:url.pathname,at:Date.now()});
    });
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(new URL('/stats/',origin).href,{waitUntil:'load'});
    await page.waitForFunction(()=>window.__paceStatsSentry&&window.__sentryProductionProbe.loadAt);
    return {context,page,sdkRequests,envelopes,errors};
}
async function sdkReady(page) {
    await page.waitForFunction(()=>window.__paceStatsSentry?.client,{timeout:15_000});
    return page.evaluate(()=>{
        const carrier=window.__SENTRY__?.[window.__SENTRY__.version];
        const client=carrier?.defaultCurrentScope?.getClient();
        if(!client)throw new Error('The actual Sentry browser client was not initialized');
        window.__sentryProductionProbe.client=client;
        client.on('startNavigationSpan',options=>window.__sentryProductionProbe.spans.push(options.name));
        return {removed:window.__sentryProductionProbe.removed,
            tracesSampleRate:client.getOptions().tracesSampleRate,debug:client.getOptions().debug,
            pendingErrors:window.__paceStatsSentry.errors.length};
    });
}
try {
    {
        const {context,page,sdkRequests,envelopes,errors}=await prepare();
        try {
            await page.waitForFunction(()=>{
                const button=[...document.querySelectorAll('.rangeButtons button')].find(button=>button.textContent==='7 days');
                const key=button&&Object.keys(button).find(key=>key.startsWith('__reactProps$'));
                return key&&typeof button[key].onMouseDown==='function';
            });
            assert.equal(sdkRequests.length,0,'Initial hydration has not downloaded the deferred SDK');
            const navigationAt=Date.now();
            await page.getByRole('button',{name:'7 days',exact:true}).click();
            await page.waitForURL(url=>url.searchParams.get('days')==='7');
            const loadAt=await page.evaluate(()=>window.__sentryProductionProbe.loadAt);
            assert.ok(navigationAt<loadAt+3_000,'The first range change happened before deferred initialization');
            const ready=await sdkReady(page);
            assert.ok(sdkRequests.length>0);
            assert.ok(sdkRequests.every(request=>request.at>=loadAt+2_950),
                'The initial range navigation must not bring the SDK ahead of the three-second initializer');
            assert.deepEqual(ready.removed,{error:true,unhandledrejection:true});
            assert.equal(ready.tracesSampleRate,0.1);assert.equal(ready.debug,false);assert.equal(ready.pendingErrors,0);
            await page.getByRole('button',{name:'30 days',exact:true}).click();
            await page.waitForURL(url=>url.searchParams.get('days')==='30');
            await page.waitForFunction(()=>window.__sentryProductionProbe.spans.length>0);
            await page.evaluate(()=>{
                const event=new ErrorEvent('error',{error:new Error('pacestats-sentry-ready-fixture'),
                    message:'pacestats-sentry-ready-fixture',cancelable:true});
                event.preventDefault();window.dispatchEvent(event);
            });
            await waitFor(()=>envelopes.some(body=>body.includes('pacestats-sentry-ready-fixture')),'Actual initialized SDK did not capture the controlled error');
            const state=await page.evaluate(()=>({sameClient:window.__sentryProductionProbe.client===window.__SENTRY__[window.__SENTRY__.version].defaultCurrentScope.getClient(),
                unhandled:window.__sentryProductionProbe.unhandled,spans:window.__sentryProductionProbe.spans}));
            assert.equal(state.sameClient,true);assert.deepEqual(state.unhandled,[]);
            assert.deepEqual(errors.filter(message=>!message.includes('pacestats-sentry-ready-fixture')),[]);
            results.push({case:'deferred-initial-navigation',loadAt,navigationAt,sdkRequests,ready,state,
                capturedSyntheticError:true,externalIngestBlocked:true});
        } finally {await context.close();}
    }
    {
        const {context,page,sdkRequests,envelopes,errors}=await prepare();
        try {
            assert.equal(sdkRequests.length,0);
            const errorAt=await page.evaluate(()=>{
                const event=new ErrorEvent('error',{error:new Error('pacestats-sentry-early-fixture'),
                    message:'pacestats-sentry-early-fixture',cancelable:true});
                event.preventDefault();const at=Date.now();window.dispatchEvent(event);return at;
            });
            const ready=await sdkReady(page);
            assert.ok(sdkRequests.length>0);assert.ok(sdkRequests[0].at<errorAt+1_000,'Early errors load the SDK immediately');
            await waitFor(()=>envelopes.some(body=>body.includes('pacestats-sentry-early-fixture')),'The queued early error did not reach the actual SDK');
            assert.deepEqual(ready.removed,{error:true,unhandledrejection:true});
            assert.equal(ready.tracesSampleRate,0.1);assert.equal(ready.pendingErrors,0);
            await delay(250);
            const unhandled=await page.evaluate(()=>window.__sentryProductionProbe.unhandled);
            assert.deepEqual(unhandled,[],'Blocked ingest must not create an unhandled-rejection loop');
            assert.deepEqual(errors.filter(message=>!message.includes('pacestats-sentry-early-fixture')),[]);
            results.push({case:'early-error-immediate-load',errorAt,sdkRequests,ready,capturedSyntheticError:true,
                unhandled,externalIngestBlocked:true});
        } finally {await context.close();}
    }
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({checks:'actual production SDK, delayed initial navigation, immediate early error capture, single client, removed bootstrap handlers, ready navigation spans, 10% traces, blocked ingest, no rejection loops',results},null,2));
    console.log(JSON.stringify({cases:results.length,checks:'real SDK deferred navigation, immediate early/ready errors, single client, bootstrap cleanup, post-init navigation tracing and no blocked-ingest rejection loops',
        sdkRequests:results.map(result=>({case:result.case,count:result.sdkRequests.length,firstDelayMs:result.sdkRequests[0].at-(result.loadAt??result.errorAt)})),output}));
} finally {await browser.close();}
