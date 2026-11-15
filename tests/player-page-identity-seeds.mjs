/** Docker-only server-page identity seeds; no SQL, Redis or external requests. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {isValidElement} from 'react';

assert.ok(existsSync('/.dockerenv'), 'Use the local Docker environment');
const root = process.cwd();
const baseline = process.env.PERF_BASELINE_ROOT ?? '/tmp/pacestats-cold2-baseline';
assert.ok(existsSync(`${baseline}/app/player/[nick]/aa/page.tsx`), 'Provide the frozen source baseline');
const require = createRequire(resolve('package.json'));
const uuid = 'fixture-uuid';
const names = {nick: 'COVlD19', uuid};
const custom = {uuid, displayName: 'Displayed name', color: '12abcd', bgColor: '223344'};
const categories = ['nether', 'bastion', 'fortress', 'stronghold', 'end', 'elytra', 'credits', 'finish'];
const lb = Object.fromEntries([0, 1, 2, 3].map(filter => [filter, Object.fromEntries(categories.map(category => [category, []]))]));
const cases = [
    {path: 'aa', body: ['getAALB', 'getRecentAARuns'], metadata: true},
    {path: 'runs/aa', body: ['getAAPlayerRunsPage']},
    {path: 'session', body: ['getSessionStats', 'getNPH'], metadata: true},
    {path: 'nethers', body: ['getRecentNethers']},
];
const dataFunctions = ['getAllNamesByNick', 'getAllNamesByTwitch', 'getAALB', 'getRecentAARuns', 'getUserInfo',
    'getAAPlayerRunsPage', 'getNPH', 'getSessionStats', 'getRecentNethers'];

async function loadPage(sourceRoot, item) {
    const result = await build({
        entryPoints: [`${sourceRoot}/app/player/[nick]/${item.path}/page.tsx`],
        bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
        plugins: [{name: 'isolated-page-data', setup(api) {
            api.onResolve({filter: /^@\//}, args => {
                if (args.path === '@/app/data') return {path: 'data', namespace: 'fixture'};
                const path = resolve(sourceRoot, args.path.slice(2));
                return {path: ['.tsx', '.ts'].map(extension => path + extension).find(existsSync) ?? path};
            });
            api.onLoad({filter: /^data$/, namespace: 'fixture'}, () => ({contents: `
                export const getCached=(fn,name,...args)=>globalThis.__pageSeedFixture.invoke(name,args);
                ${dataFunctions.map(name => `export const ${name}=()=>{};`).join('\n')}
            `}));
            api.onResolve({filter: /^next\/link$/}, () => ({path: 'Link', namespace: 'component'}));
            api.onLoad({filter: /(?:AAPlayerPage|SessionPage|AARecentRuns|PlayerInfoSeed|ResetScroll|Nethers)\.tsx$/}, args => {
                const name = args.path.split('/').at(-1).replace('.tsx', '');
                return {contents: `function Component(){return null;} Component.displayName=${JSON.stringify(name)};
                    export default Component; export {Component as ${name}};`, loader: 'tsx'};
            });
            api.onLoad({filter: /.*/, namespace: 'component'}, args => ({contents: `
                function Component(){return null;} Component.displayName=${JSON.stringify(args.path)}; export default Component;`}));
        }}],
    });
    const compiled = {exports: {}};
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, compiled, compiled.exports);
    return compiled.exports;
}

function normalize(node, seeds = []) {
    if (Array.isArray(node)) return node.flatMap(value => {
        const normalized = normalize(value, seeds);
        return normalized === undefined ? [] : [normalized];
    });
    if (!isValidElement(node)) {
        if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, normalize(value, seeds)]));
        return node;
    }
    const type = typeof node.type === 'symbol' ? String(node.type) : node.type.displayName ?? node.type.name ?? node.type;
    if (type === 'PlayerInfoSeed') {seeds.push(node.props);return undefined;}
    const props = Object.fromEntries(Object.entries(node.props).map(([key, value]) => [key, normalize(value, seeds)]));
    // New seeds are siblings of the unchanged original component.
    if (typeof node.type === 'symbol' && Array.isArray(props.children)) {
        const meaningful = props.children.filter(value => value !== false && value !== null && value !== undefined);
        if (meaningful.length === 1) return meaningful[0];
    }
    if (Array.isArray(props.children)) props.children = props.children.filter(value => value !== false && value !== undefined);
    return {type, props};
}

let checked = 0;
for (const item of cases) {
    const oldPage = await loadPage(baseline, item), newPage = await loadPage(root, item);
    for (const mode of ['custom', 'default', 'unavailable', 'alias', 'unknown']) {
        const pair = [];
        for (const [index, page] of [oldPage, newPage].entries()) {
            const calls = [];
            let release;
            const gate = new Promise(done => {release = done;});
            globalThis.__pageSeedFixture = {invoke: async (name, args) => {
                calls.push({name, args});
                if (name === 'getAllNamesByNick') return ['alias', 'unknown'].includes(mode) ? null : names;
                if (name === 'getAllNamesByTwitch') return mode === 'unknown' ? null : names;
                assert.ok([...item.body, 'getUserInfo'].includes(name), `Unexpected/global read: ${name}`);
                await gate;
                if (name === 'getUserInfo') {
                    assert.deepEqual(args, [uuid]);
                    if (mode === 'unavailable') throw new Error('Injected optional customization outage');
                    return mode === 'default' ? null : custom;
                }
                if (name === 'getAALB') return lb;
                if (name === 'getAAPlayerRunsPage') return {rows: [], nextCursor: null, hasMore: false};
                if (name === 'getNPH') return {count: 0};
                if (name === 'getSessionStats') return {};
                return [];
            }};
            const props = {params: Promise.resolve({nick: mode === 'alias' ? 'streamer-alias' : 'jojoe77777'}), searchParams: Promise.resolve({})};
            const pending = page.default(props);
            for (let tick = 0; tick < 16; tick++) await Promise.resolve();
            if (mode !== 'unknown') {
                assert.deepEqual(calls.filter(call => !call.name.startsWith('getAllNames')).map(call => call.name).sort(),
                    [...item.body, ...(index ? ['getUserInfo'] : [])].sort(), 'All independent reads start before any body read resolves');
            }
            release();
            const tree = await pending, seeds = [];
            const body = normalize(tree, seeds);
            if (index && !['unknown', 'unavailable'].includes(mode)) {
                assert.deepEqual(seeds, [{nick: names.nick, info: {id: uuid,
                    displayName: mode === 'default' ? null : custom.displayName,
                    color: mode === 'default' ? null : custom.color,
                    bgColor: mode === 'default' ? null : custom.bgColor}}]);
            } else assert.deepEqual(seeds, [], 'Failed customization leaves the normal client fallback available');
            const metadata = item.metadata ? await page.generateMetadata(props) : undefined;
            pair.push({body, metadata});
        }
        assert.deepEqual(pair[1], pair[0], `Body/metadata changed: ${item.path}/${mode}`);
        checked++;
    }
}
delete globalThis.__pageSeedFixture;
console.log(`PASS: ${checked} frozen-page comparisons preserve body/metadata; canonical/default identity seeds are scoped and parallel; unknown/outage cases retain fallback`);
