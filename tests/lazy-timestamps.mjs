/** Docker-only SSR workload: exact timestamp formatting must stay out of closed tooltips. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {build} from 'esbuild';

if (!existsSync('/.dockerenv')) throw new Error('Run inside local Docker.');
const root = resolve(process.env.PERF_SOURCE_ROOT ?? process.cwd());
const require = createRequire(resolve(root, 'package.json'));
globalThis.exactTimeCalls = 0;
const result = await build({
    stdin: {contents: `
        import React from 'react';
        import {renderToStaticMarkup} from 'react-dom/server';
        import RelativeTimer from './app/components/profile/RelativeTimer';
        module.exports = renderToStaticMarkup(<>{Array.from({length:100}, (_,i) =>
            <RelativeTimer key={i} start={1700000000+i} compactBelow="md"/>)}</>);
    `, resolveDir: root, loader: 'tsx'},
    bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
    external: ['react', 'react/*', 'react-dom', 'react-dom/*'],
    plugins: [{name:'timestamp-counter', setup(api) {
        api.onResolve({filter:/^@\/app\/components\/profile\/relativeTime$/}, () => ({path:'clock', namespace:'stub'}));
        api.onLoad({filter:/.*/, namespace:'stub'}, () => ({contents:`
            export const fromNow = () => '2 years ago';
            export const formatExactTime = () => { globalThis.exactTimeCalls++; return 'Exact timestamp'; };
        `}));
    }}],
});
const output = {exports:{}};
new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, output, output.exports);
assert.equal((output.exports.match(/2 years ago/g) ?? []).length, 200);
if (!process.env.PERF_SOURCE_ROOT) assert.equal(globalThis.exactTimeCalls, 0);
console.log(JSON.stringify({source:root, rows:100, exactTimeCalls:globalThis.exactTimeCalls, htmlBytes:output.exports.length}));
