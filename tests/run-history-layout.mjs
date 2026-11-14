/** Docker only: node --import tsx tests/run-history-layout.mjs */
import assert from 'node:assert/strict';
import {layoutEncodedRunHistory, layoutRunHistory} from '../app/runHistory.ts';

const line = index => `${100000 - index},120000,180000,220000,180000,220000,,,400000,,1794000000000,,player`;
for (const length of [0, 1, 2, 127, 128, 129, 130, 511, 512, 513, 21_593]) {
    const lines = Array.from({length}, (_, index) => line(index));
    assert.deepEqual(layoutEncodedRunHistory(lines.join('\n'), 'v1'), layoutRunHistory(lines, 'v1'));
}
for (let round = 0; round < 1000; round++) {
    const lines = Array.from({length: round % 700}, (_, index) => index % 19 === 0 ? '' : index % 17 === 0 ? 'bad' : line(index));
    const body = lines.join('\n');
    assert.deepEqual(layoutEncodedRunHistory(body, 'unique-version'), layoutRunHistory(body.split('\n'), 'unique-version'));
}
console.log('Encoded history layout: head/base boundaries, versions, empty, trailing and malformed run lines match the array layout.');

if (process.env.PERF_BENCHMARK === '1') {
    const body = Array.from({length: 21_593}, (_, index) => line(index)).join('\n');
    const measures = {reference: [], current: []};
    let sink = 0;
    for (let round = 0; round < 7; round++) {
        for (const name of round % 2 ? ['current', 'reference'] : ['reference', 'current']) {
            const start = process.cpuUsage();
            for (let iteration = 0; iteration < 150; iteration++) {
                const result = name === 'reference' ? layoutRunHistory(body.split('\n'), 'version') : layoutEncodedRunHistory(body, 'version');
                // Include the UTF-8 work a Redis write performs, so cons strings
                // cannot make a deferred copy look like removed work.
                sink += Buffer.from(result.head).length + Buffer.from(result.base ?? '').length;
            }
            const used = process.cpuUsage(start);
            measures[name].push((used.user + used.system) / 1000);
        }
    }
    const median = values => values.sort((a, b) => a - b)[3];
    console.log(JSON.stringify({benchmark: 'encoded history layout plus wire encoding', rows: 21593, calls: 150,
        referenceCpuMs: median(measures.reference), currentCpuMs: median(measures.current), sink}));
}
