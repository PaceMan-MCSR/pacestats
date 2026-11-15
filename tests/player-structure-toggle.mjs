/** Local Docker: profile columns already exist; changing them needs no RSC read. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createRequire} from 'node:module';

assert.ok(existsSync('/.dockerenv'));
const servers=[{kind:'baseline',url:process.env.PERF_BASELINE_URL},
    {kind:'final',url:process.env.PERF_BASE_URL}].filter(server=>server.url);
assert.ok(servers.length);
for(const server of servers)assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(server.url).hostname));
const output=process.env.PERF_OUTPUT??'/app/test-artifacts/performance/cold-loads/structure-toggle.json';
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try{
    for(const server of servers){
        const base=new URL(server.url),context=await browser.newContext({viewport:{width:1365,height:900}});
        try{
            await context.route('**/*',route=>{
                const url=new URL(route.request().url());
                if(url.pathname.includes('/_next/image')&&/^https?:/.test(url.searchParams.get('url')??''))
                    return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'});
                if(url.origin===base.origin)return route.continue();
                return route.request().resourceType()==='image'
                    ?route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'})
                    :route.abort();
            });
            const page=await context.newPage(),errors=[],reads=[];
            page.setDefaultTimeout(30_000);
            page.on('pageerror',error=>errors.push(error.message));
            page.on('request',request=>{
                const url=new URL(request.url());
                if(url.origin===base.origin&&(request.headers().rsc==='1'||url.searchParams.has('_rsc')))
                    reads.push({path:url.pathname,query:url.search});
            });
            const cdp=await context.newCDPSession(page);
            await cdp.send('Network.enable');
            await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:300,downloadThroughput:1_250_000,uploadThroughput:625_000});
            await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
            const path='player/NoFearr1337/';
            const ready=()=>page.waitForFunction(()=>{
                const button=[...document.querySelectorAll('button')].find(button=>/Bastion\/Fortress|First\/Second Structure/.test(button.textContent));
                return button&&Object.keys(button).some(key=>key.startsWith('__reactProps$'));
            });
            const columns=separate=>page.locator('.statHeader').filter({hasText:separate?/^Bastion$/:/^First Structure$/}).waitFor();
            await page.goto(new URL(`${path}?days=9999&probe=keep`,base).href,{waitUntil:'domcontentloaded'});
            await ready();await columns(false);
            const mark=reads.length;
            await page.getByRole('button',{name:'Bastion/Fortress',exact:true}).click();
            await page.waitForURL(url=>url.searchParams.get('bastionFort')==='true');await columns(true);
            if(server.kind==='baseline')await page.waitForFunction(()=>document.querySelector('.rangeButtons')?.getAttribute('aria-busy')!=='true');
            // Include the old navigation's response and any late framework work.
            await page.waitForTimeout(server.kind==='baseline'?1_200:500);
            const profilePath=new URL(path,base).pathname;
            const toggleReads=reads.slice(mark).filter(read=>read.path===profilePath&&new URLSearchParams(read.query).get('bastionFort')==='true');
            assert.equal(new URL(page.url()).searchParams.get('probe'),'keep');
            if(server.kind==='final'){
                assert.equal(toggleReads.length,0,'A presentation-only profile toggle needs no server request');
                await page.goBack();await columns(false);
                assert.equal(new URL(page.url()).searchParams.get('bastionFort'),null);
                await page.goForward();await columns(true);
                await page.getByRole('button',{name:'First/Second Structure',exact:true}).click();await columns(false);
                for(const [days,label]of [[1,'24 hours'],[7,'7 days'],[30,'30 days'],[9999,'Lifetime']]){
                    await page.getByRole('button',{name:label,exact:true}).click();
                    await page.waitForURL(url=>url.searchParams.get('days')===String(days));
                    await page.locator('.rangeButtons button:disabled').waitFor({state:'detached'});
                    await page.getByRole('button',{name:'Bastion/Fortress',exact:true}).click();
                    await page.getByRole('button',{name:'First/Second Structure',exact:true}).waitFor();
                    await page.goBack();
                    await page.getByRole('button',{name:'Bastion/Fortress',exact:true}).waitFor();
                    assert.equal(new URL(page.url()).searchParams.get('days'),String(days));
                    assert.equal(new URL(page.url()).searchParams.get('probe'),'keep');
                }
                await page.goto(new URL(`${path}?days=9999&bastionFort=true`,base).href,{waitUntil:'domcontentloaded'});
                await ready();await columns(true);
                await page.getByRole('button',{name:'First/Second Structure',exact:true}).click();await columns(false);
                // The front page holds selected tables only, so it must still fetch.
                await page.goto(new URL('?days=9999',base).href,{waitUntil:'domcontentloaded'});await ready();
                const frontMark=reads.length;
                await page.getByRole('button',{name:'Bastion/Fortress',exact:true}).click();
                await page.waitForURL(url=>url.searchParams.get('bastionFort')==='true');
                await page.locator('.stats-row:not([aria-busy="true"])').waitFor();
                assert.ok(reads.slice(frontMark).some(read=>read.path===base.pathname),'Front still navigates to its server-projected tables');
            }else assert.ok(toggleReads.length>0,'The frozen baseline exercises the redundant RSC request');
            assert.deepEqual(errors,[]);
            results.push({kind:server.kind,toggleRscRequests:toggleReads.length,
                checks:server.kind==='final'?'local columns, URL, Back/Forward, all four ranges, initial separate-view SSR, retained front navigation':'baseline presentation toggle causes server navigation'});
        }finally{await context.close();}
    }
}finally{await browser.close();}
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify({method:'Functional production routing at300ms/4x; delay includes server navigation for request-count parity, not a page latency benchmark',results},null,2));
console.log(JSON.stringify({output,results}));
