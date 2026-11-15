/** Docker-only real React row work; optional baseline root compares old code. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'esbuild';
assert.ok(existsSync('/.dockerenv'),'Use local Docker');
const root=resolve(process.env.PERF_SOURCE_ROOT??process.cwd());
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';
    import AARecentRuns from './app/player/[nick]/runs/aa/AARecentRuns';
    window.cellVisits=0;window.requests=[];
    const now=Date.now,started=now();window.ageOffset=0;Date.now=()=>now()+window.ageOffset;
    const rows=Array.from({length:1000},(_,id)=>{
        const cells=Array(8).fill('1:40');
        cells.map=function(callback){window.cellVisits+=this.length;return Array.prototype.map.call(this,callback);};
        return {id:id+1,live:id===0,time:id===0?started/1000-20:1700000000,cells};
    });
    window.fetch=(url,options={})=>new Promise((resolve,reject)=>{
        const item={url,resolve,signal:options.signal};window.requests.push(item);
        options.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));
    });
    createRoot(document.getElementById('root')).render(<AARecentRuns uuid="fixture"
        initialPage={{rows,nextCursor:1,hasMore:true}}/>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'local-css',setup(api){
    api.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'empty'}));api.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
    api.onResolve({filter:/^@\//},args=>{const base=resolve(root,args.path.slice(2));return {path:['.tsx','.ts'].map(ext=>base+ext).find(existsSync)??base};});
}}]});
const server=createServer((_req,res)=>res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`));
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1000);
    const initial=await page.evaluate(()=>window.cellVisits);assert.equal(initial,8000);
    await page.evaluate(()=>window.cellVisits=0);
    await page.getByRole('button',{name:'Load more runs',exact:true}).click();
    await page.getByRole('button',{name:'Loading...',exact:true}).waitFor();
    const loading=await page.evaluate(()=>window.cellVisits);
    await page.evaluate(()=>window.requests[0].resolve({ok:false,status:503}));
    await page.getByText('Could not load more runs. Try again.').waitFor();
    const failed=await page.evaluate(()=>window.cellVisits);
    await page.getByRole('button',{name:'Load more runs',exact:true}).click();
    await page.waitForFunction(()=>window.requests.length===2);
    await page.evaluate(()=>window.requests[1].resolve({ok:true,json:async()=>({rows:Array.from({length:100},(_,i)=>({
        id:2000+i,twitch:null,lastUpdated:1700000000000,nether:100000,bastion:null,fortress:null,stronghold:null,end:null,elytra:null,credits:null,finish:null,
    })),nextCursor:null,hasMore:false})}));
    await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1100);
    const appended=await page.evaluate(()=>window.cellVisits);
    assert.equal(await page.locator('tbody tr').last().locator('td').nth(1).innerText(),'1:40');
    const beforeClock=await page.locator('tbody tr').first().locator('td').first().innerText();
    await page.evaluate(()=>window.ageOffset+=5000);
    await page.waitForFunction(previous=>document.querySelector('tbody tr td').textContent!==previous,beforeClock);
    const afterClock=await page.locator('tbody tr').first().locator('td').first().innerText();
    assert.notEqual(afterClock,beforeClock,'A memoized row retains its own live timestamp subscription');
    assert.deepEqual(errors,[]);
    if(!process.env.PERF_SOURCE_ROOT)assert.deepEqual({loading,failed,appended},{loading:0,failed:0,appended:0});
    console.log(JSON.stringify({source:root,initialRows:1000,initialCellVisits:initial,existingCellVisits:{loading,failed,appended},
        finalRows:1100,liveClockChanged:true,checks:'same existing rows avoid cell rebuilding during loading/failure/retry/append; new cells and independent live clock still update'}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
