/** Docker-only actual SWR/RunData integration, with optional frozen source root. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {build} from 'esbuild';
assert.ok(existsSync('/.dockerenv'), 'Use local Docker');
const root=resolve(process.env.PERF_SOURCE_ROOT??process.cwd());
const {chromium}=createRequire('/tmp/pacestats-perf/package.json')('playwright');
const bundle=await build({stdin:{resolveDir:root,loader:'tsx',contents:`
    import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {SWRConfig,useSWRConfig} from 'swr';
    import RunData from './app/run/[worldid]/RunData';
    import {RunStoreProvider,useRunStoreApi} from './app/run/[worldid]/RunStore';
    const row={id:42,worldId:'fixture',nickname:'Fixture',uuid:'uuid',twitch:'streamer',
        nether:100000,bastion:null,fortress:null,first_portal:null,stronghold:null,end:null,finish:null,
        netherRta:100100,bastionRta:null,fortressRta:null,first_portalRta:null,strongholdRta:null,endRta:null,finishRta:null,
        insertTime:1700000000,updateTime:1700000001,realUpdate:null,vodId:null,vodOffset:0};
    const initial={data:row,isLive:true,liveStatusUnknown:false,time:1};
    const key='/stats/api/getWorld/?worldId=hash-fixture';
    window.requests=[];window.counts={store:0,history:0,title:0};window.last=initial;
    window.fetch=url=>new Promise(resolve=>window.requests.push({url,resolve}));
    const replace=history.replaceState.bind(history);
    history.replaceState=(...args)=>{window.counts.history++;return replace(...args);};
    window.setUrl=url=>replace(null,'',url);
    const title=Object.getOwnPropertyDescriptor(Document.prototype,'title');
    Object.defineProperty(document,'title',{get(){return title.get.call(this);},set(value){window.counts.title++;title.set.call(this,value);}});
    function Capture(){const store=useRunStoreApi();const {mutate}=useSWRConfig();useEffect(()=>{
        const unsubscribe=store.subscribe(()=>window.counts.store++);
        window.state=()=>store.getState();
        window.deliver=async value=>{window.last=value;await mutate(key,value,{revalidate:false});await new Promise(done=>setTimeout(done,0));};
        window.respond=(index,value)=>{window.last=value;window.requests[index].resolve({ok:true,json:async()=>value});};
        window.ready=true;return unsubscribe;
    },[store,mutate]);return null;}
    createRoot(document.getElementById('root')).render(<SWRConfig value={{provider:()=>new Map(),dedupingInterval:0,focusThrottleInterval:0}}>
        <RunStoreProvider initialWorld={initial}><Capture/><RunData params={{worldid:'hash-fixture'}} initialWorld={initial}/></RunStoreProvider>
    </SWRConfig>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'},plugins:[{name:'aliases',setup(api){
    api.onResolve({filter:/^@\//},args=>{const base=resolve(root,args.path.slice(2));return {path:['.tsx','.ts'].map(ext=>base+ext).find(existsSync)??base};});
}}]});
const server=createServer((_req,res)=>res.end(`<div id="root"></div><script>${bundle.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`));
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/stats/run/hash-fixture/?seed#fragment`);
    await page.waitForFunction(()=>window.ready&&document.title.includes('Fixture'));
    assert.equal(new URL(page.url()).pathname,'/stats/run/42/');
    assert.equal(new URL(page.url()).search+new URL(page.url()).hash,'');
    assert.equal(await page.evaluate(()=>window.requests.length),0,'SSR fallback does not immediately refetch');
    const unchanged=await page.evaluate(async()=>{
        window.counts={store:0,history:0,title:0};
        for(let i=0;i<20;i++)await window.deliver({...window.last,data:{...window.last.data},time:100+i});
        return {...window.counts};
    });
    const metadata=await page.evaluate(async()=>{
        window.counts={store:0,history:0,title:0};
        for(let i=0;i<20;i++)await window.deliver({...window.last,data:{...window.last.data,updateTime:1800000000+i},time:200+i});
        return {...window.counts};
    });
    if(!process.env.PERF_SOURCE_ROOT){
        assert.deepEqual(unchanged,{store:0,history:0,title:0});
        assert.deepEqual(metadata,{store:20,history:0,title:0});
    }
    for(const suffix of ['?query=1#fragment','?','#']){
        await page.evaluate(async suffix=>{window.setUrl('/stats/run/42/'+suffix);await window.deliver({...window.last,data:{...window.last.data,updateTime:window.last.data.updateTime+1}});},suffix);
        assert.equal(page.url(),`http://127.0.0.1:${server.address().port}/stats/run/42/`,'Canonicalization also strips empty URL delimiters');
    }
    await page.waitForFunction(()=>window.requests.length===1);
    await page.evaluate(()=>window.respond(0,{...window.last,isLive:false,liveStatusUnknown:true,data:{...window.last.data,nickname:'Unconfirmed'}}));
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(()=>window.state().isLive),true);
    assert.equal(await page.evaluate(()=>window.state().data.nickname),'Fixture','Unknown live status preserves confirmed data');
    await page.waitForFunction(()=>window.requests.length===2);
    await page.evaluate(()=>window.respond(1,{...window.last,isLive:true,liveStatusUnknown:false,data:{...window.last.data,nickname:'Updated',bastion:200000,vodId:'late-vod'}}));
    await page.waitForFunction(()=>window.state().data.bastion===200000);
    assert.match(await page.title(),/Updated/);
    assert.match(await page.title(),/Bastion/);
    await page.evaluate(()=>window.deliver({...window.last,isLive:false}));
    assert.equal(await page.evaluate(()=>window.state().dying),true);
    await page.evaluate(()=>window.deliver({...window.last,isLive:true}));
    assert.equal(await page.evaluate(()=>window.state().dying),false,'A live update cancels the death grace period');
    await page.evaluate(()=>window.deliver({...window.last,isLive:false}));
    await page.waitForFunction(()=>!window.state().isLive&&!window.state().dying,{},{timeout:7000});
    const beforeFocus=await page.evaluate(()=>window.requests.length);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(count=>window.requests.length>count,beforeFocus);
    await page.evaluate(index=>window.respond(index,{...window.last,data:{...window.last.data,vodId:'corrected-after-settling'}}),beforeFocus);
    await page.waitForFunction(()=>window.state().data.vodId==='corrected-after-settling');
    const beforeReconnect=await page.evaluate(()=>window.requests.length);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    await page.waitForFunction(count=>window.requests.length>count,beforeReconnect);
    await page.evaluate(index=>window.respond(index,null),beforeReconnect);
    await page.waitForFunction(()=>window.state().data===null);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({source:root,responses:20,unchanged,metadata,requests:await page.evaluate(()=>window.requests.length),checks:'actual SWR polling, unknown/live/death transitions, timer cancellation, title/split changes, late settled VOD correction on focus, reconnect deletion, exact canonical URL'}));
}finally{await browser.close();await new Promise(done=>server.close(done));}
