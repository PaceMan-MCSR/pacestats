/** Docker-only React integration test. Optional PERF_SOURCE_ROOT compares an older checkout. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';

if (!existsSync('/.dockerenv')) throw new Error('Run this test inside the local Docker environment.');
const root = resolve(process.env.PERF_SOURCE_ROOT ?? process.cwd());
const require = createRequire(process.env.PERF_PLAYWRIGHT_PACKAGE ?? '/tmp/pacestats-perf/package.json');
const {chromium} = require('playwright');
const stubs = {
    fonts: 'export const mcFont = {style:{}};',
    RunData: 'export default function RunData(){return null;}',
    ResetScroll: 'export default function ResetScroll(){return null;}',
    PendingLink: "import React from 'react'; export default function Link({children,...props}){return <a {...props}>{children}</a>;}",
    'react-twitch-embed': "import React from 'react'; export const TwitchPlayer = () => <div data-testid='player'/>; export const TwitchChat = () => <div/>;",
};
const bundle = await build({
    stdin: {contents: `
        import React, {Profiler, useEffect} from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import RunPage from './app/run/[worldid]/RunPage';
        import {RunStoreProvider, useRunStoreApi} from './app/run/[worldid]/RunStore';
        const data = {id:42, uuid:'fixture', nickname:'Fixture', insertTime:1700000000, realUpdate:null,
            updateTime:1700000000, vodId:null, vodOffset:0, twitch:null, nether:100000, netherRta:101000,
            bastion:null, fortress:null, first_portal:null, stronghold:null, end:null, finish:null,
            bastionRta:null, fortressRta:null, first_portalRta:null, strongholdRta:null, endRta:null, finishRta:null};
        const initialWorld = {data, isLive:false};
        window.commits = 0;
        window.copied = '';
        Object.defineProperty(navigator, 'clipboard', {value:{writeText: text => {window.copied = text; return Promise.resolve();}}});
        function Capture(){const store = useRunStoreApi(); useEffect(() => {
            window.patch = patch => flushSync(() => store.setState({data:{...store.getState().data, ...patch}}));
            window.setRunState = patch => flushSync(() => store.setState(patch));
            window.ready = true;
        },[store]);return null;}
        createRoot(document.getElementById('root')).render(<RunStoreProvider initialWorld={initialWorld}>
            <Capture/><Profiler id='run' onRender={() => window.commits++}>
            <RunPage params={{worldid:'42'}} initialWorld={initialWorld}/></Profiler></RunStoreProvider>);
    `, resolveDir: root, loader: 'tsx'},
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx:'automatic',
    // Development React retains Profiler measurements; this tests actual renders,
    // not production latency. Network and Twitch are deliberately out of scope.
    define: {'process.env.NODE_ENV': '"development"'},
    plugins: [{name:'fixture-dependencies', setup(api) {
        api.onResolve({filter:/\.css$/}, () => ({path:'css',namespace:'empty'}));
        api.onLoad({filter:/.*/,namespace:'empty'}, () => ({contents:'',loader:'js'}));
        api.onResolve({filter:/^@\//}, args => {
            const name = args.path.split('/').pop();
            if (name in stubs) return {path:name, namespace:'stub'};
            return {path:resolve(root, args.path.slice(2) + '.tsx')};
        });
        api.onResolve({filter:/^react-twitch-embed$/}, () => ({path:'react-twitch-embed',namespace:'stub'}));
        api.onLoad({filter:/.*/,namespace:'stub'}, args => ({contents:stubs[args.path],loader:'jsx',resolveDir:root}));
    }}],
});
const script = bundle.outputFiles[0].text;
const server = createServer((_request,response) => {
    response.setHeader('Content-Type','text/html');
    response.end(`<div id="root"></div><script>${script.replaceAll('</script','<\\/script')}</script>`);
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror',error => errors.push(error.message));
    await page.route('**/*',route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready).catch(error => {throw new Error(`${error.message}; browser: ${errors.join('; ')}`);});
    const counts = await page.evaluate(() => {
        window.commits = 0;
        for(let i=0;i<100;i++) window.patch({updateTime:1700000001+i, liveStatusUnknown:false});
        const metadataCommits = window.commits;
        window.commits = 0;
        window.patch({bastion:200000, bastionRta:201000});
        return {metadataCommits, splitCommits:window.commits};
    });
    assert.match(await page.locator('.runHeader h1').innerText(),/3:20 Enter Bastion/);
    assert.equal(await page.locator('.card-line').count(),2);
    await page.locator('.copy-splits').click();
    assert.equal(await page.evaluate(() => window.copied),'1:40 Nether\n3:20 Bastion');
    await page.locator('.copy-url').click();
    assert.match(await page.evaluate(() => window.copied),/\/stats\/run\/42\/$/);
    await page.evaluate(() => {window.patch({vodId:'123',vodOffset:10}); window.setRunState({vodEmbed:{seek:time => window.seekTime=time}});});
    await page.locator('.split-name.has-vod').last().click();
    assert.equal(await page.evaluate(() => window.seekTime),213);
    await page.evaluate(() => window.setRunState({isLive:true}));
    assert.match(await page.locator('.live-text').innerText(),/updating live/);
    await page.evaluate(() => window.setRunState({dying:true}));
    assert.equal(await page.locator('.live-text').count(),0);
    await page.evaluate(() => window.setRunState({data:null}));
    assert.equal(await page.locator('h1').innerText(),'Unknown run');
    assert.deepEqual(errors,[]);
    assert.ok(counts.splitCommits > 0);
    if (!process.env.PERF_SOURCE_ROOT) assert.equal(counts.metadataCommits,0);
    console.log(JSON.stringify({source:root,...counts,checks:'split updates, clipboard, VOD seeking, live/death state, unknown run'}));
} finally {
    await browser.close();
    await new Promise(done => server.close(done));
}
