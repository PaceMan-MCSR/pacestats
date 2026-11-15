/** Docker-only real React search/identity lifecycle; private HTTP, no DB/services. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';

if (!existsSync('/.dockerenv')) throw new Error('Run inside local Docker.');
const root = process.cwd();
const require = createRequire('/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const result = await build({
    stdin: {contents: `
        import React,{useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import Fuse from 'fuse.js';
        import PlayerSearch from './app/components/PlayerSearch';
        import {usePlayerInfo,seedPlayerInfo} from './app/components/playerInfoStore';
        window.requests=[]; window.prefetches=[]; window.fuseAttempts=0;
        window.loadFixtureFuse=()=>++window.fuseAttempts===1
            ?Promise.reject(new Error('Injected transient lazy-chunk failure')):Promise.resolve({default:Fuse});
        window.fetch=(url,{signal}={})=>new Promise((resolve,reject)=>{
            const request={url,signal,aborted:false,done:false,
                respond:(data,status=200)=>{request.done=true;resolve({ok:status===200,status,json:async()=>data});}};
            signal?.addEventListener('abort',()=>{request.aborted=true;reject(new DOMException('Aborted','AbortError'));});
            window.requests.push(request);
        });
        window.seed=seedPlayerInfo;
        function Identity({name}) {const info=usePlayerInfo(name);
            return <div className="identity" data-name={name}>{info===undefined?'unknown':info===null?'missing':info.color??info.id}</div>;}
        function App(){const [names,setNames]=useState([]);
            window.identities=names=>flushSync(()=>setNames(names));
            return <><button id="outside">Outside</button><div id="a"><PlayerSearch/></div>
                <div id="b"><PlayerSearch/></div><div id="identities">{names.map(name=><Identity key={name} name={name}/>)}</div></>;}
        createRoot(document.getElementById('root')).render(<App/>);
    `, resolveDir: root, loader: 'tsx'},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: {'process.env.NODE_ENV': '"development"'},
    plugins: [{name: 'private-fixture-dependencies', setup(api) {
        api.onResolve({filter: /\.css$/}, () => ({path: 'css', namespace: 'empty'}));
        api.onLoad({filter: /.*/, namespace: 'empty'}, () => ({contents: ''}));
        api.onResolve({filter: /^next\/navigation$/}, () => ({path: 'router', namespace: 'stub'}));
        api.onLoad({filter: /.*/, namespace: 'stub'}, () => ({contents: `
            const router={prefetch:(...args)=>window.prefetches.push(args),push:path=>{window.selectedPath=path;}};
            export const useRouter=()=>router;`}));
        api.onResolve({filter: /^@\//}, args => {
            const path = resolve(root, args.path.slice(2));
            return {path: ['.tsx', '.ts', '.js'].map(extension => path + extension).find(existsSync) ?? path};
        });
        // Only the lazy provider changes: real Fuse, shared loader, React
        // component and retry/error handling are the production implementation.
        api.onLoad({filter: /SearchAutocomplete\.tsx$/}, args => ({
            contents: readFileSync(args.path, 'utf8').replace('import("fuse.js")', 'window.loadFixtureFuse()'),
            loader: 'tsx', resolveDir: resolve(root, 'app/components/search'),
        }));
    }}],
});
const script = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html'); response.end(`<div id="root"></div><script>${script}</script>`);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({headless: true, args: ['--no-sandbox']});
try {
    const page = await browser.newPage();
    page.setDefaultTimeout(12_000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const first = page.locator('#a input'), second = page.locator('#b input');
    await first.focus();
    await page.waitForFunction(() => window.fuseAttempts === 1 && window.requests.length === 1);
    await second.focus();
    await page.waitForFunction(() => window.fuseAttempts === 2);
    assert.equal(await page.evaluate(() => window.requests.filter(request => request.url.includes('getPlayerNames')).length), 1,
        'Two search boxes share the background name-list load');
    await second.fill('Fix');
    await page.waitForFunction(() => window.requests.some(request => request.url.includes('searchPlayers')));
    await page.waitForFunction(() => window.requests.every(request => request.aborted));
    assert.deepEqual(errors, [], 'A failed lazy chunk is caught, and hanging HTTP work has a deadline');

    await first.focus();
    await page.waitForFunction(() => window.requests.filter(request => request.url.includes('getPlayerNames')).length === 2);
    await first.fill('Fix');
    await page.waitForFunction(() => window.requests.filter(request => request.url.includes('searchPlayers')).length === 2);
    await page.evaluate(() => window.requests.filter(request => request.url.includes('searchPlayers')).at(-1)
        .respond([{id: 'remote-uuid', name: 'Fixture', color: null}]));
    await page.locator('#a [data-test="result"]').waitFor();
    assert.equal(await page.locator('#a [data-test="result"]').innerText(), 'Fixture', 'Remote search remains usable before the full list arrives');
    await page.evaluate(() => window.requests.filter(request => request.url.includes('getPlayerNames')).at(-1)
        .respond(['Fixture', ['Other', 'Streamer']]));
    await page.waitForFunction(() => window.requests.some(request => request.url.includes('getPlayerInfo')));
    await page.evaluate(() => {
        window.seed('Fixture', {id: 'seed-uuid', displayName: 'Fixture', color: 'abcdef', bgColor: null});
        window.requests.filter(request => request.url.includes('getPlayerInfo')).at(-1)
            .respond({fixture: {id: 'stale-uuid', displayName: 'Fixture', color: '000000', bgColor: null}});
    });
    assert.match(await page.locator('#a [data-test="result"] img').getAttribute('src'), /seed-uuid/);
    await page.locator('#outside').click();
    await second.focus(); await second.fill('Stream');
    await page.locator('#b [data-test="result"]').waitFor();
    assert.equal(await page.locator('#b [data-test="result"]').innerText(), 'Other', 'Shared successful name data preserves Twitch-handle matching');
    assert.equal(await page.evaluate(() => window.fuseAttempts), 2, 'Successful Fuse loads are reused');
    assert.equal(await page.evaluate(() => window.requests.filter(request => request.url.includes('searchPlayers')).length), 2,
        'Local indexed searches do not start more query requests');
    await page.locator('#outside').click();

    await page.evaluate(() => window.identities(['seed-race', 'neighbor']));
    await page.waitForFunction(() => window.requests.some(request => request.url.includes('seed-race')));
    await page.evaluate(() => {
        window.seed('seed-race', {id: 'new', displayName: null, color: '123456', bgColor: null});
        window.requests.find(request => request.url.includes('seed-race')).respond({
            'seed-race': {id: 'old', displayName: null, color: '000000', bgColor: null},
            neighbor: {id: 'neighbor', displayName: null, color: null, bgColor: null},
        });
    });
    await page.waitForFunction(() => document.querySelector('[data-name="neighbor"]').textContent === 'neighbor');
    assert.equal(await page.locator('[data-name="seed-race"]').innerText(), '123456', 'A shared older response cannot overwrite a seeded row');

    await page.evaluate(() => window.identities(['orphan-a', 'orphan-b']));
    await page.waitForFunction(() => window.requests.some(request => request.url.includes('orphan-a')));
    await page.evaluate(() => window.identities(['orphan-b']));
    assert.equal(await page.evaluate(() => window.requests.find(request => request.url.includes('orphan-a')).aborted), false);
    await page.evaluate(() => window.identities([]));
    await page.waitForFunction(() => window.requests.find(request => request.url.includes('orphan-a')).aborted);

    await page.evaluate(() => window.identities(Array.from({length: 130}, (_, index) => `cold-${index}`)));
    await page.waitForFunction(() => window.requests.filter(request => request.url.includes('cold-')).length === 2);
    for (let round = 0; round < 5; round++) {
        const pending = await page.evaluate(() => window.requests.filter(request => request.url.includes('cold-') && !request.done && !request.aborted).length);
        assert.ok(pending <= 2, 'The actual React store caps concurrent cold requests');
        await page.evaluate(() => {
            for (const request of window.requests.filter(request => request.url.includes('cold-') && !request.done && !request.aborted)) {
                const names = new URL(request.url, location.href).searchParams.get('names').split(',');
                request.respond(Object.fromEntries(names.map(name => [name, {id: name, displayName: null, color: null, bgColor: null}])));
            }
        });
        if (round < 3) await page.waitForFunction(count => window.requests.filter(request => request.url.includes('cold-')).length >= count, Math.min(7, (round + 2) * 2));
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.identity')].every(row => row.textContent !== 'unknown'));
    assert.equal(await page.evaluate(() => window.requests.filter(request => request.url.includes('cold-')).length), 7);
    assert.deepEqual(errors, []);
    console.log('PASS: real React search recovers lazy failure; names/query HTTP abort after 8s; two boxes share names/Fuse; remote/local/Twitch search remains usable; seeds win; orphaned work cancels; 130 cold rows use seven batches and at most two concurrent requests');
} finally {
    await browser.close(); await new Promise(done => server.close(done));
}
