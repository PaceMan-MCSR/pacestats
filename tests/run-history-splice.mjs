/** Docker only: node --import tsx tests/run-history-splice.mjs */
import assert from 'node:assert/strict';
import {spliceRunHistory} from '../app/runHistory.ts';

export function reference(existing, patches) {
    const output = [];
    let next = 0;
    let position = 0;
    while (position < existing.length && next < patches.length) {
        const newline = existing.indexOf('\n', position);
        const lineEnd = newline < 0 ? existing.length : newline;
        const id = Number(existing.slice(position, existing.indexOf(',', position)));
        while (next < patches.length && patches[next].id > id) output.push(patches[next++].line);
        if (next < patches.length && patches[next].id === id) output.push(patches[next++].line);
        else output.push(existing.slice(position, lineEnd));
        position = lineEnd + 1;
    }
    while (next < patches.length) output.push(patches[next++].line);
    if (position < existing.length) output.push(existing.slice(position));
    return output.join('\n');
}

let seed = 0x98765fed;
const random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
};
for (let round = 0; round < 12_000; round++) {
    const length = Math.floor(random() * 250);
    const lines = Array.from({length}, (_, index) => `${length * 3 - index * 2},run-${index},${'x'.repeat(index % 30)}`);
    let existing = lines.join('\n');
    if (round % 5 === 0 && existing) existing += '\n';
    if (round % 7 === 0 && existing) existing += '\n';
    const patches = Array.from({length: Math.floor(random() * 12)}, (_, index) => {
        const id = Math.floor(random() * (length * 4 + 10)) - 5;
        return {id, line: `${id},patch-${index}`};
    }).sort((a, b) => b.id - a.id);
    assert.equal(spliceRunHistory(existing, patches), reference(existing, patches), `round ${round}`);
}
for (const existing of ['', '\n', '\n\n', 'bad', 'bad\n', '0,\n', '1,a\n\n']) {
    for (const patches of [[], [{id: 2, line: '2,new'}], [{id: 0, line: '0,new'}], [{id: -1, line: '-1,new'}]]) {
        assert.equal(spliceRunHistory(existing, patches), reference(existing, patches));
    }
}
console.log('History splice: 12,000 merge cases, insert/replace ordering, duplicate patches, empty and trailing lines matched the previous producer.');

if (process.env.PERF_BENCHMARK === '1') {
    const existing = Array.from({length: 21_593}, (_, index) => `${100000 - index},120000,180000,220000,180000,220000,,,400000,,1794000000000,,player`).join('\n');
    const patches = [{id: 80000, line: '80000,updated'}];
    const measures = {reference: [], current: []};
    let sink = 0;
    for (let round = 0; round < 7; round++) {
        for (const name of round % 2 ? ['current', 'reference'] : ['reference', 'current']) {
            const run = name === 'reference' ? reference : spliceRunHistory;
            const start = process.cpuUsage();
            for (let iteration = 0; iteration < 150; iteration++) sink += run(existing, patches).length;
            const used = process.cpuUsage(start);
            measures[name].push((used.user + used.system) / 1000);
        }
    }
    const median = values => values.sort((a, b) => a - b)[3];
    console.log(JSON.stringify({benchmark: 'old-base history patch', rows: 21593, calls: 150,
        referenceCpuMs: median(measures.reference), currentCpuMs: median(measures.current), sink}));
}
