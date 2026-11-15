/** Local Docker production pages, actual snapshot broker, public API and frozen-page parity. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, resolve} from 'node:path';

assert.ok(existsSync('/.dockerenv'), 'Use local Docker');
const require = createRequire('/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const baseline = process.env.PERF_BASELINE_URL ?? 'http://127.0.0.1:5095';
const candidate = process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5096';
for (const origin of [baseline,candidate]) {
    const url = new URL(origin);
    assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname), 'Only local services are allowed');
}
assert.ok(process.env.WS_TOKEN, 'Pass the local Docker WS_TOKEN without printing it');
const output = resolve(process.env.PERF_OUTPUT ?? 'test-artifacts/performance/obs-live/production-parity.json');
const names = 'NoFearr1337,CroProYT';
const cases = [
    {kind:'session',player:'NoFearr1337'},
    {kind:'nethers',player:'NoFearr1337',dp:1,nph:true,nphDp:2},
    {kind:'nethers',player:'CroProYT',dp:3,nph:false,nphDp:3},
    {kind:'combinedStats',player:names,pathEncoding:'escaped'},
    {kind:'combinedStats',player:names,pathEncoding:'literal'},
    {kind:'combinedNethers',player:names,maxTime:300000,pathEncoding:'escaped'},
    {kind:'combinedNethers',player:names,maxTime:300000,pathEncoding:'literal'},
];
const routes = {session:['session','getSessionStats'],nethers:['sessionNethers','getSessionNethers'],
    combinedStats:['combinedStats','getCombinedStats'],combinedNethers:['combinedNethers','getCombinedNethers']};
const categories = ['nether','bastion','fortress','first_portal','stronghold','end','finish'];
function query(item,demo=false) {
    return new URLSearchParams({hours:'239976',hoursBetween:'239976',showAvg:'true',dynamic:'false',
        color:'123abc',font:'Arial',start:'0',maxTime:String(item.maxTime??99999999),
        nph:String(item.nph??true),dp:String(item.dp??0),nphDp:String(item.nphDp??0),demo:String(demo)});
}
function apiUrl(origin,item) {
    const params=query(item),combined=item.kind.startsWith('combined');
    params.set(combined?'names':'name',item.player);
    return `${origin}/stats/api/${routes[item.kind][1]}/?${params}`;
}
const expectedTexts = (item,data) => item.kind==='nethers'
    ? [String(data.count),data.avg,item.nph?(data.rnph||0).toFixed(item.nphDp):'']
    : item.kind==='combinedNethers' ? [`${data.count}${data.avg}`]
    : categories.map(category=>`${data[category].count} ${data[category].avg}`);
const compact = text => text.replaceAll(/\s/g,'');
const requestKinds = new Set(Object.values(routes).map(route=>route[1]));
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const results=[];
try {
    const unauthorized=await fetch(`${candidate}/stats/api/obsSnapshot/?kind=session&name=NoFearr1337`,{redirect:'error'});
    assert.equal(unauthorized.status,401);
    assert.match(unauthorized.headers.get('cache-control'),/no-store/);
    for(const item of cases.filter(item=>!process.env.PERF_OVERLAY_KIND||item.kind===process.env.PERF_OVERLAY_KIND)) {
        const previous=await fetch(apiUrl(baseline,item),{redirect:'error'});
        assert.equal(previous.status,200);
        const expected=await previous.json();
        const current=await fetch(apiUrl(candidate,item),{redirect:'error'});
        assert.equal(current.status,200);
        assert.deepEqual(await current.json(),expected,'Public API values remain unchanged');
        const params=query(item);params.set('kind',item.kind);
        params.set(item.kind.startsWith('combined')?'names':'name',item.player);
        const snapshot=await fetch(`${candidate}/stats/api/obsSnapshot/?${params}`,{
            redirect:'error',headers:{authorization:`Bearer ${process.env.WS_TOKEN}`},
        });
        assert.equal(snapshot.status,200,'Exact protected endpoint does not redirect');
        assert.match(snapshot.headers.get('cache-control'),/no-store/);
        const snapshotData=await snapshot.json();
        assert.ok(snapshotData.uuids.length>=1);
        assert.deepEqual(snapshotData.data,item.kind==='nethers'&&!item.nph?{...expected,rnph:0}:expected);
        for(const demo of [false,true]) {
            const pages=[];
            for(const [label,origin,wsPort] of [['baseline',baseline,'8091'],['candidate',candidate,'8092']]) {
                console.log(`Checking ${label} ${item.kind} ${item.player} demo=${demo} path=${item.pathEncoding??'escaped'}`);
                const context=await browser.newContext();
                const page=await context.newPage(),apiRequests=[],sockets=[],messages=[],errors=[];
                page.on('pageerror',error=>errors.push(error.message));
                page.on('request',request=>{
                    const url=new URL(request.url()),name=url.pathname.split('/').filter(Boolean).at(-1);
                    if(requestKinds.has(name)) apiRequests.push(url.pathname);
                });
                page.on('websocket',socket=>{
                    if(new URL(socket.url()).port===wsPort) {
                        sockets.push(socket.url());
                        socket.on('framereceived',event=>messages.push(String(event.payload)));
                    }
                });
                await page.route('**/*',route=>{
                    const url=new URL(route.request().url());
                    return ['localhost','127.0.0.1','[::1]'].includes(url.hostname)?route.continue():route.abort();
                });
                const playerPath=item.pathEncoding==='literal'?item.player:encodeURIComponent(item.player);
                const target=`${origin}/stats/obs/${routes[item.kind][0]}/${playerPath}/?${query(item,demo)}`;
                const navigation=await page.goto(target,{waitUntil:'domcontentloaded'});
                const selector=item.kind==='session'||item.kind==='combinedStats'?'.main .split-name':'.main h1';
                let initialHtmlValues=false;
                if(label==='candidate'&&!demo) {
                    const html=await navigation.text();
                    const serverTexts=await page.evaluate(({html,selector})=>{
                        const document=new DOMParser().parseFromString(html,'text/html');
                        return [...document.querySelectorAll(selector)].map(node=>node.textContent.replaceAll(/\s/g,''));
                    },{html,selector});
                    assert.deepEqual(serverTexts,expectedTexts(item,expected).map(compact),
                        'The first server HTML contains overlay values before client fetch or WebSocket setup');
                    initialHtmlValues=true;
                }
                await page.waitForFunction(({selector,texts})=>{
                    const nodes=[...document.querySelectorAll(selector)];
                    const normalize=text=>text.replaceAll(/\s/g,'');
                    return nodes.length===texts.length&&nodes.every((node,index)=>normalize(node.textContent)===normalize(texts[index]));
                },{selector,texts:expectedTexts(item,expected)},{timeout:30_000}).catch(async error=>{
                    throw new Error(`${error.message}; ${label}/${item.kind}/demo=${demo}; expected ${JSON.stringify(expectedTexts(item,expected))}; actual ${JSON.stringify(await page.locator(selector).allTextContents())}; main ${JSON.stringify(await page.locator('.main').innerText())}; runtime ${JSON.stringify(errors)}; API ${JSON.stringify(apiRequests)}; sockets ${JSON.stringify(sockets)}; WS ${JSON.stringify(messages)}`);
                });
                const visible=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>{
                    const style=getComputedStyle(node);
                    return {text:node.textContent.replaceAll(/\s/g,''),color:style.color,font:style.fontFamily,fontSize:style.fontSize,textAlign:style.textAlign};
                }));
                assert.deepEqual(visible.map(node=>node.text),expectedTexts(item,expected).map(compact));
                assert.ok(visible.every(node=>node.color==='rgb(18, 58, 188)'&&node.font.includes('Arial')));
                if(label==='candidate'&&!demo) {
                    // SSR values can be visible before hydration opens the
                    // stream. Require its real initial frame before checking
                    // that healthy client delivery made no browser API call.
                    const deadline=Date.now()+30_000;
                    while(!messages.some(message=>{
                        try{return JSON.parse(message).type==='snapshot';}catch{return false;}
                    })) {
                        if(Date.now()>deadline) throw new Error(`No live snapshot after SSR seed: ${item.kind}`);
                        await new Promise(done=>setTimeout(done,20));
                    }
                } else await page.waitForTimeout(100);
                if(demo) {
                    assert.equal(apiRequests.length,1,`${label}: each demo fetches once`);
                    assert.equal(sockets.length,label==='baseline'&&item.kind==='nethers'?1:0,
                        'Live demo sockets are removed from the old nether preview');
                } else if(label==='candidate') {
                    assert.equal(apiRequests.length,0,'A healthy live overlay makes no browser API requests');
                    assert.equal(sockets.length,1);
                    assert.ok(messages.some(message=>{
                        try{return JSON.parse(message).type==='snapshot';}catch{return false;}
                    }),'Initial data arrives over the actual broker WebSocket');
                } else {
                    assert.equal(apiRequests.length,1,'The frozen overlay fetches its initial API value');
                }
                assert.deepEqual(errors,[]);
                pages.push({label,visible,initialHtmlValues,apiRequests:apiRequests.length,sockets:sockets.length,
                    snapshotMessages:messages.filter(message=>message.startsWith('{')).length});
                await context.close();
            }
            assert.deepEqual(pages[1].visible,pages[0].visible,`${item.kind} actual rendered value/style parity`);
            results.push({kind:item.kind,player:item.player,pathEncoding:item.pathEncoding??'escaped',demo,dp:item.dp,nph:item.nph,pages});
        }
    }
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({checks:'production value/style parity, zero healthy browser API fetches, real WS initial data, API compatibility, authenticated/no-store/no-redirect provider, demo compatibility',results},null,2));
    console.log(JSON.stringify({cases:results.length,checks:'actual production four overlay types, two players, combined players, nph on/off, precision1/3, values/styles, real websocket snapshots, zero healthy browser API reads, public/API auth/header parity, demos',output}));
} finally {await browser.close();}
