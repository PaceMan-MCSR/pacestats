import assert from 'node:assert/strict';
import {loadProducerModule} from '../scripts/producer-module.mjs';

const {producer, dispose} = await loadProducerModule('scripts/cache.ts', ['topLeaderboards', 'finalizePaceSummaries']);
try {
    for (const count of [0, 1, 9, 10, 11, 100, 2000]) {
        const players = new Map(Array.from({length: count}, (_, index) => [`player-${index}`, {
            name: `Player ${index}`, stats: {nether: [index % 40, index + 0.5, index % 9 + 1]},
            minima: {nether: [index % 9 + 1, index + 10]},
        }]));
        if (count > 0) players.set('partial-cache-entry', {name: 'Partial', stats: {}, minima: {nether: [2, 30]}});
        for (const day of [1, 7, 30, 9999]) {
            const {full, top, fastest} = producer.finalizePaceSummaries(players, day);
            const expected = {};
            for (const filter of [0, 1, 2, 3]) {
                expected[filter] = {};
                for (const category of Object.keys(full[filter])) {
                    const eligible = filter === 1 || filter === 3
                        ? full[filter][category].filter(entry => entry.qty >= producer.getMinQty(category, day))
                        : full[filter][category];
                    expected[filter][category] = eligible.slice(0, 10);
                }
            }
            for (const category of Object.keys(fastest)) {
                const lookup = new Map(full[2][category].map(entry => [entry.uuid, entry]));
                expected[2][category] = fastest[category].slice(0, 10).map(entry => ({...lookup.get(entry.uuid), ...entry}));
            }
            assert.equal(JSON.stringify(top), JSON.stringify(expected), `count=${count}, day=${day}`);
        }
    }
    console.log('Top-board byte parity: empty, short/full boards, ties, minimum quantities and all periods passed.');
    if (process.env.PERF_BENCHMARK === '1') {
        const board = Array.from({length: 10_000}, (_, index) => ({uuid: `player-${index}`, qty: index % 100 + 1}));
        const input = Object.fromEntries([0, 1, 2, 3].map(filter => [filter, {nether: board}]));
        function reference() {
            return Object.fromEntries([0, 1, 2, 3].map(filter => [filter, {nether:
                (filter === 1 || filter === 3 ? board.filter(entry => entry.qty >= producer.getMinQty('nether', 7)) : board).slice(0, 10)}]));
        }
        const results = {reference: [], current: []};
        let sink = 0;
        for (let round = 0; round < 7; round++) {
            for (const name of round % 2 ? ['current', 'reference'] : ['reference', 'current']) {
                const start = process.cpuUsage();
                for (let repeat = 0; repeat < 1000; repeat++) sink += (name === 'reference' ? reference() : producer.topLeaderboards(input, ['nether'], 7))[1].nether.length;
                const used = process.cpuUsage(start);
                results[name].push((used.user + used.system) / 1000);
            }
        }
        assert.ok(sink > 0);
        console.log(JSON.stringify(results));
    }
} finally {await dispose();}
