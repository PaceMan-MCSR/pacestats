/** Local Docker React integration workloads; no database/external services or page timing. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';

if (!existsSync('/.dockerenv')) throw new Error('Run inside local Docker.');
const root = resolve(process.env.PERF_SOURCE_ROOT ?? process.cwd());
const require = createRequire('/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const stubs = {
    PlayerSearch: `import React from 'react'; export default function Search({setOutput}){
        return <button id="choose-player" onClick={()=>setOutput('Fixture')}>Choose player</button>;}`,
    FontPicker: `import React from 'react'; export default function FontPicker(){return <div/>;}`,
    ResetScroll: 'export default function ResetScroll(){return null;}',
    Session: `import React from 'react'; export default function Session(props){window.sessionRenders++;
        window.sessionProps=props; return <div id="session-preview" data-color={props.settings.color}/>;}`,
    SessionNethers: `import React from 'react'; export default function Nethers(props){window.nethersRenders++;
        window.nethersProps=props; return <div id="nethers-preview" data-color={props.settings.color}/>;}`,
    ObsColorPicker: `import React from 'react';
        export function ColorPicker(props){window.dragColor=props.onChange; return <div id="drag-color" data-color={props.color}/>;}
        export function ColorInput(props){window.typeColor=props.onChange; return <input id="text-color" value={props.color} onChange={e=>props.onChange(e.target.value)}/>;}`,
    dynamic: `import React from 'react'; export default function dynamic(loader){return React.lazy(async()=>({default:await loader()}));}`,
};
const result = await build({
    stdin: {contents: `
        import React,{Profiler,Suspense,useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import ObsWrapper from './app/obs/ObsWrapper';
        import AARecentRuns from './app/player/[nick]/runs/aa/AARecentRuns';
        import {recentRunRows} from './app/components/profile/recentRunPresentation';
        import SearchAutocomplete from './app/components/search/SearchAutocomplete';
        import RelativeTimer from './app/components/profile/RelativeTimer';
        window.sessionRenders=0; window.nethersRenders=0; window.obsCommits=0;
        window.searchCommits=0; window.dismissals=0; window.aaRequests=[];
        window.fetch=(url,{signal}={})=>new Promise((resolve,reject)=>{
            const request={url,aborted:false,respond:resolve}; window.aaRequests.push(request);
            signal?.addEventListener('abort',()=>{request.aborted=true; reject(new DOMException('Aborted','AbortError'));});
        });
        const run=id=>({id,twitch:null,lastUpdated:1700000000000,nether:id*100000,
            bastion:null,fortress:null,stronghold:null,end:null,elytra:null,credits:null,finish:null});
        window.pageWith=(id,hasMore=false)=>({rows:[{...run(id),...recentRunRows([run(id)],true)[0]}],nextCursor:hasMore?id:null,hasMore});
        const searchItems=[{id:1,name:'Fixture'}];
        function App(){
            const [mode,setMode]=useState('obs'); const [uuid,setUuid]=useState('A');
            window.show=mode=>flushSync(()=>setMode(mode));
            window.changePlayer=uuid=>flushSync(()=>setUuid(uuid));
            return <Suspense fallback={<p>Loading controls</p>}>
                <button id="outside">Outside</button>
                {mode==='obs'&&<Profiler id="obs" onRender={()=>window.obsCommits++}><ObsWrapper userInfo={[]} params={{}}/></Profiler>}
                {mode==='aa'&&<AARecentRuns key={uuid} uuid={uuid} initialPage={window.pageWith(uuid==='A'?1:2,true)}/>}
                {mode==='search'&&<Profiler id="search" onRender={()=>window.searchCommits++}>
                    <SearchAutocomplete items={searchItems} onDismiss={()=>window.dismissals++}/></Profiler>}
                {mode==='tooltip'&&<RelativeTimer start={1700000000}/>}
            </Suspense>;
        }
        window.colorBurst=()=>{for(let i=0;i<100;i++) flushSync(()=>window.dragColor('#'+String(i).padStart(6,'0')));};
        createRoot(document.getElementById('root')).render(<App/>);
    `, resolveDir:root, loader:'tsx'},
    bundle:true, write:false, platform:'browser', format:'iife', jsx:'automatic',
    define:{'process.env.NODE_ENV':'"development"','process.env.NEXT_PUBLIC_HOSTNAME':'"http://127.0.0.1"'},
    plugins:[{name:'fixture-dependencies',setup(api){
        api.onResolve({filter:/\.css$/},()=>({path:'css',namespace:'empty'}));
        api.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));
        api.onResolve({filter:/^@\//},args=>{
            const name=args.path.split('/').pop();
            if(name in stubs) return {path:name,namespace:'stub'};
            const path=resolve(root,args.path.slice(2));
            const resolved=['.tsx','.ts','.js'].map(extension=>path+extension).find(existsSync);
            return {path:resolved??path};
        });
        api.onResolve({filter:/^next\/dynamic$/},()=>({path:'dynamic',namespace:'stub'}));
        api.onResolve({filter:/^\.\/ObsColorPicker$/},()=>({path:'ObsColorPicker',namespace:'stub'}));
        api.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:root}));
    }}],
});
const script=result.outputFiles[0].text.replaceAll('</script','<\\/script');
const server=createServer((_request,response)=>{
    response.setHeader('Content-Type','text/html'); response.end(`<div id="root"></div><script>${script}</script>`);
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
    const page=await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors=[]; page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#choose-player').click();
    await page.locator('#session-preview').waitFor({state:'attached'});
    await page.waitForFunction(()=>window.dragColor&&window.typeColor);
    const before=await page.evaluate(()=>({session:window.sessionRenders,nethers:window.nethersRenders}));
    await page.locator('.hours').first().fill('48');
    await page.evaluate(()=>window.sessionProps.setWidth(777));
    await page.waitForFunction(()=>document.querySelector('.sizeHint').textContent==='777x0');
    const unrelated=await page.evaluate(()=>({session:window.sessionRenders,nethers:window.nethersRenders}));
    if(!process.env.PERF_SOURCE_ROOT) assert.deepEqual(unrelated,before);
    await page.getByRole('button',{name:'Preview updated hours'}).click();
    assert.equal(await page.evaluate(()=>window.sessionProps.settings.hours),'48');
    assert.equal(await page.evaluate(()=>window.nethersProps.settings.hours),'48');
    const renders=await page.evaluate(()=>{
        const start=window.obsCommits; window.colorBurst(); return {start,during:window.obsCommits-start};
    });
    await page.waitForFunction(()=>window.sessionProps.settings.color==='#000099');
    const dragCommits=await page.evaluate(start=>window.obsCommits-start,renders.start);
    if(!process.env.PERF_SOURCE_ROOT) {assert.equal(renders.during,0); assert.equal(dragCommits,1);}
    await page.evaluate(()=>window.dragColor('#123456'));
    await page.locator('.colorSection').dispatchEvent('pointerup');
    await page.waitForFunction(()=>window.sessionProps.settings.color==='#123456');
    await page.evaluate(()=>window.typeColor('#abcdef'));
    await page.waitForFunction(()=>window.sessionProps.settings.color==='#abcdef');
    assert.match(await page.locator('.urlBox').first().innerText(),/color=abcdef/);

    await page.evaluate(()=>window.show('search'));
    await page.waitForTimeout(50);
    const closed=await page.evaluate(()=>({commits:window.searchCommits,dismissals:window.dismissals}));
    for(let i=0;i<10;i++) await page.locator('#outside').click();
    const afterClosed=await page.evaluate(()=>({commits:window.searchCommits,dismissals:window.dismissals}));
    if(!process.env.PERF_SOURCE_ROOT) assert.deepEqual(afterClosed,closed);
    await page.locator('input').focus();
    await page.locator('#outside').click();
    assert.ok(await page.evaluate(()=>window.dismissals)>closed.dismissals);

    await page.evaluate(()=>window.show('tooltip'));
    await page.locator('#root > span').hover();
    await page.getByRole('tooltip').waitFor({state:'visible'});
    assert.match(await page.getByRole('tooltip').innerText(),/2023/);
    await page.locator('#outside').hover();
    await page.getByRole('tooltip').waitFor({state:'hidden'});
    await page.locator('#root > span').evaluate(element=>element.dispatchEvent(new FocusEvent('focusin',{bubbles:true})));
    await page.getByRole('tooltip').waitFor({state:'visible'});

    if(!process.env.PERF_SOURCE_ROOT) {
        await page.evaluate(()=>window.show('aa'));
        await page.getByRole('button',{name:'Load more runs'}).evaluate(button=>{button.click();button.click();});
        assert.equal(await page.evaluate(()=>window.aaRequests.length),1);
        await page.evaluate(()=>window.changePlayer('B'));
        assert.equal(await page.evaluate(()=>window.aaRequests[0].aborted),true);
        assert.equal(await page.locator('tbody tr').count(),1);
        assert.equal(await page.locator('tbody tr td').nth(1).innerText(),'3:20');
        await page.evaluate(()=>window.aaRequests[0].respond({ok:true,json:async()=>window.pageWith(99)}));
        await page.getByRole('button',{name:'Load more runs'}).click();
        assert.match(await page.evaluate(()=>window.aaRequests[1].url),/uuid=B/);
        await page.evaluate(()=>window.aaRequests[1].respond({ok:false,status:503}));
        await page.getByText('Could not load more runs. Try again.').waitFor();
        await page.getByRole('button',{name:'Load more runs'}).click();
        await page.evaluate(()=>window.aaRequests[2].respond({ok:true,json:async()=>window.pageWith(3)}));
        await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===2);
        assert.equal(await page.getByRole('button',{name:'Load more runs'}).count(),0);
        assert.equal(await page.locator('tbody tr td').nth(1).innerText(),'3:20');
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({source:root,previewRenders:{before,unrelated},dragCommits,
        closedSearch:{before:closed,after:afterClosed},checks:'settings/URL/color final values, timestamp hover/focus, AA duplicate/abort/route isolation/retry'}));
} finally {await browser.close();await new Promise(done=>server.close(done));}
