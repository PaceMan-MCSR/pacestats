/** Docker-only real React/SWR/WebSocket browser integration, with private local providers. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {WebSocket, WebSocketServer} from 'ws';

assert.ok(existsSync('/.dockerenv'), 'Run in the local Docker environment');
const root = process.cwd();
const require = createRequire('/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const requests = [], connections = [], policies = new Map(), held = [];
let script = '';
const data = (kind, count) => kind === 'nethers' || kind === 'combinedNethers'
    ? {count, avg: '1:23', rnph: 12, uuid: 'fixture-uuid'}
    : Object.fromEntries(['nether', 'bastion', 'fortress', 'first_portal', 'stronghold', 'end', 'finish']
        .map(split => [split, {count, avg: '1:23'}]));
const kindFor = path => ({getSessionStats: 'session', getSessionNethers: 'nethers',
    getCombinedStats: 'combinedStats', getCombinedNethers: 'combinedNethers'})[path.split('/').filter(Boolean).at(-1)];
const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.startsWith('/stats/api/')) {
        const name = url.searchParams.get('name') ?? url.searchParams.get('names');
        const kind = kindFor(url.pathname), entry = {name, kind, url: url.href};
        requests.push(entry);
        const policy = policies.get(name) ?? {status: 200, count: 70};
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        if (policy.hold) {held.push({entry, response}); return;}
        response.statusCode = policy.status;
        if (policy.status >= 400) response.setHeader('Retry-After', '1');
        response.end(JSON.stringify(policy.status >= 400 ? {error: 'Temporary fixture outage'} : data(kind, policy.count)));
        return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<div id="root"></div><script>${script}</script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const endpoint = `ws://127.0.0.1:${server.address().port}`;
const wss = new WebSocketServer({server});
const send = (connection, count, sequence = ++connection.sequence, version = 1) => {
    connection.sequence = Math.max(connection.sequence, sequence);
    if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify({
        type: 'snapshot', version, sequence, data: data(connection.kind, count),
    }));
};
wss.on('connection', (socket, request) => {
    const url = new URL(request.url, 'http://localhost'), name = url.searchParams.get('name') ?? url.searchParams.get('names');
    const connection = {socket, name, kind: url.searchParams.get('kind'), params: url.searchParams, sequence: 0};
    connections.push(connection);
    if (name === 'legacy') {socket.close(1008, 'Legacy server has no overlay protocol');return;}
    const generation = connections.filter(item => item.name === name && item.kind === connection.kind).length;
    send(connection, name === 'reconnect' && generation > 1 ? 30 : 10);
});
const bundle = await build({
    stdin: {contents: `
        import React,{useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import Session from './app/obs/session/[nick]/Session';
        import Nethers from './app/obs/sessionNethers/[nick]/SessionNethers';
        import CombinedStats from './app/obs/combinedStats/[names]/CombinedStats';
        import CombinedNethers from './app/obs/combinedNethers/[names]/CombinedNethers';
        function App(){
            const [items,setItems]=useState([]);
            window.mount=items=>flushSync(()=>setItems(items));
            return items.map(item=>{
                const settings={hours:24,hoursBetween:2,color:'#000000',font:'Arial',demo:false,
                    showAvg:true,dynamic:false,nph:true,nphDp:0,nphRight:false,liveOnly:false,decimals:0,start:0,maxTime:99999999,
                    ...item.settings};
                const Component={session:Session,nethers:Nethers,combinedStats:CombinedStats,combinedNethers:CombinedNethers}[item.kind];
                return <section key={item.id} id={item.id}><Component name={item.name} names={item.name} settings={settings}/></section>;
            });
        }
        createRoot(document.getElementById('root')).render(<App/>);
    `, resolveDir: root, loader: 'tsx'},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_WS_ENDPOINT': JSON.stringify(endpoint)},
    plugins: [{name: 'local-aliases', setup(api) {
        api.onResolve({filter: /^@\//}, args => {
            const path = resolve(root, args.path.slice(2));
            return {path: ['.tsx', '.ts', '.js'].map(extension => path + extension).find(existsSync) ?? path};
        });
    }}],
});
script = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
const counts = name => requests.filter(request => request.name === name).length;
const latest = (name, kind = 'nethers') => connections.filter(connection => connection.name === name && connection.kind === kind).at(-1);
const waitUntil = async (condition, label, timeout = 10_000) => {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
        await new Promise(done => setTimeout(done, 20));
    }
};
try {
    const page = await browser.newPage(), errors = [];
    page.setDefaultTimeout(10_000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {Math.random = () => 0;});
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.mount);
    const mount = async items => page.evaluate(items => window.mount(items), items);
    const value = async id => page.locator(`#${id} .split-name, #${id} h1`).first().innerText();
    const expectValue = async (id, expected) => {
        const deadline = Date.now() + 10_000;
        while (Number.parseInt(await value(id), 10) !== expected) {
            if (Date.now() > deadline) throw new Error(`${id}: expected ${expected}, got ${await value(id)}; browser errors ${errors.join('; ')}`);
            await page.clock.runFor(5);
            await new Promise(done => setTimeout(done, 15));
        }
    };
    const items = [{id:'s',kind:'session',name:'fixture'},{id:'s2',kind:'session',name:'fixture'},
        {id:'n',kind:'nethers',name:'fixture'},{id:'cs',kind:'combinedStats',name:'fixture,other'},
        {id:'cn',kind:'combinedNethers',name:'fixture,other'}];
    await mount(items);
    for (const item of items) await expectValue(item.id, 10);
    assert.equal(connections.length, 4, 'Identical overlays share their actual websocket');
    assert.equal(requests.length, 0, 'Initial socket snapshots need no browser API fetch');
    for (const connection of connections) send(connection, 20);
    for (const item of items) await expectValue(item.id, 20);
    for (const connection of connections) {send(connection, 999, 1);send(connection, 999, 99, 2);connection.socket.send('{invalid');}
    await page.clock.runFor(70_000);
    await page.evaluate(() => {window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));});
    await page.clock.runFor(100);
    assert.equal(requests.length, 0, 'Healthy sockets disable interval/focus/reconnect HTTP revalidation');
    for (const item of items) await expectValue(item.id, 20);

    items[0] = {...items[0],name:'changed',settings:{hours:48}};
    await mount(items);
    await expectValue('s', 10);
    send(latest('fixture', 'session'), 21, 100);await expectValue('s2',21);await expectValue('s',10);
    send(latest('changed', 'session'), 31);await expectValue('s',31);await expectValue('s2',21);
    assert.equal(latest('changed','session').params.get('hours'), '48');

    await mount([items[2]]);
    const nethers = latest('fixture');
    policies.set('fixture', {hold:true});
    nethers.socket.send('{"type":"snapshot-error","version":1}');
    await page.clock.runFor(600);
    await waitUntil(() => held.length === 1, 'Held fallback request');
    send(nethers,33,100);await expectValue('n',33);
    held.shift().response.end(JSON.stringify(data('nethers',999)));
    await new Promise(done => setTimeout(done, 50));
    await expectValue('n',33);
    assert.equal(counts('fixture'),1,'A newer pushed snapshot fences older API data');

    policies.set('fixture',{status:503,count:0});
    nethers.socket.send('{"type":"snapshot-error","version":1}');
    await page.clock.runFor(600);
    await waitUntil(()=>counts('fixture')===2,'503 fallback');
    await new Promise(done=>setTimeout(done,30));await expectValue('n',33);
    policies.set('fixture',{status:429,count:0});
    await page.clock.runFor(11_000);
    await waitUntil(()=>counts('fixture')===3,'429 retry');
    await new Promise(done=>setTimeout(done,30));await expectValue('n',33);
    policies.set('fixture',{status:200,count:44});
    await page.clock.runFor(21_000);
    await waitUntil(()=>counts('fixture')===4,'Successful bounded retry');await expectValue('n',44);
    send(nethers,45,101);await expectValue('n',45);

    await mount([]);
    const beforeDemoConnections=connections.length,beforeDemoRequests=requests.length;
    const demos=['session','nethers','combinedStats','combinedNethers'].map((kind,index)=>({id:`d${index}`,kind,name:`demo${index}`,settings:{demo:true}}));
    await mount(demos);
    for(const item of demos) await expectValue(item.id,70);
    await page.clock.runFor(70_000);
    assert.equal(connections.length,beforeDemoConnections,'Demo previews use no websocket');
    assert.equal(requests.length-beforeDemoRequests,4,'Each demo fetches once without background polling');

    policies.set('legacy',{status:200,count:55});
    await mount([{id:'legacy',kind:'nethers',name:'legacy'}]);
    await page.clock.runFor(100);
    await waitUntil(()=>Boolean(latest('legacy')),'Legacy connection');
    await page.clock.runFor(100);
    await expectValue('legacy',55);
    await page.clock.runFor(12_000);
    assert.equal(connections.filter(connection=>connection.name==='legacy').length,1,'1008 legacy close does not reconnect repeatedly');
    assert.equal(counts('legacy'),1,'Legacy fallback loads through the original API');

    policies.set('reconnect',{hold:true});
    await mount([{id:'r',kind:'nethers',name:'reconnect'}]);
    await expectValue('r',10);
    const first=latest('reconnect');send(first,20,500);await expectValue('r',20);first.socket.terminate();
    await new Promise(done=>setTimeout(done,30));
    await page.clock.runFor(1200);
    await waitUntil(()=>connections.filter(connection=>connection.name==='reconnect').length===2,'Reconnected socket');
    await expectValue('r',30);
    for(const request of held.splice(0)) request.response.end(JSON.stringify(data('nethers',999)));
    await new Promise(done=>setTimeout(done,50));await expectValue('r',30);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({checks:'four real overlays, shared socket, zero healthy API reads through70s/focus, pushed values, sequence/version rejection, key isolation, late HTTP fencing,503/429 retries, demo and legacy compatibility, reconnect sequence reset',connections:connections.length,apiRequests:requests.length}));
    await mount([]);
} finally {
    await browser.close();
    for(const connection of connections) connection.socket.terminate();
    for(const request of held.splice(0)) request.response.destroy();
    await new Promise(done=>wss.close(done));
    await new Promise(done=>server.close(done));
}
