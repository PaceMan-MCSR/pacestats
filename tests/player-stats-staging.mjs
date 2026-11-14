import assert from 'node:assert/strict';
import {loadProducerModule} from '../scripts/producer-module.mjs';

const {producer, dispose} = await loadProducerModule('scripts/cache.ts', ['calculatePlayerStats', 'paceCategories']);
function reference(users, boards, days) {
    const data = new Map(users.map(user => [user.id, Object.fromEntries(producer.paceCategories.map(category => [category, {}]))]));
    for (const filter of [0, 1, 2, 3]) {
        for (const category of producer.paceCategories) {
            const min = filter === 2 || filter === 0 ? 0 : producer.getMinQty(category, days);
            let rank = 0;
            for (const entry of boards[filter][category]) {
                if (entry.qty === 0) continue;
                const player = data.get(entry.uuid);
                if (entry.qty < min) {if (player) player[category][filter] = {ranking: -1, value: entry.value};}
                else {rank++; if (player) player[category][filter] = {ranking: rank, value: entry.value};}
            }
        }
    }
    return [...data].map(([uuid, value]) => [`playerStats:${uuid}:${days}day`, value]);
}
function fixture(count, active) {
    const users = Array.from({length: count}, (_, index) => ({id: `p-${index}`}));
    const boards = Object.fromEntries([0, 1, 2, 3].map(filter => [filter, Object.fromEntries(producer.paceCategories.map(category => [category,
        Array.from({length: active}, (_, index) => ({uuid: index % 11 === 0 ? `unknown-${index}` : `p-${index % Math.max(1, count)}`, qty: index % 50, value: index * 10 + filter})),
    ]))]));
    return {users, boards};
}
try {
    for (const [count, active] of [[0, 0], [1, 0], [10, 0], [3, 40], [100, 30], [100, 150]]) {
        const {users, boards} = fixture(count, active);
        if (users.length) users.push(users[0]);
        for (const day of [1, 7, 30, 9999]) {
            assert.equal(JSON.stringify([...producer.calculatePlayerStats(users, boards, day)]), JSON.stringify(reference(users, boards, day)));
        }
    }
    console.log('Player stats staging: exact bytes/order, duplicate users, unknown ranked users, zero counts and eligibility across periods passed.');
    if (process.env.PERF_BENCHMARK === '1') {
        const {users, boards} = fixture(10_000, 100);
        let sink = 0;
        const rounds = {reference: [], current: []};
        for (let round = 0; round < 7; round++) {
            for (const name of round % 2 ? ['current', 'reference'] : ['reference', 'current']) {
                const cpu = process.cpuUsage();
                for (let repeat = 0; repeat < 10; repeat++) {
                    const result = name === 'reference' ? reference(users, boards, 1) : producer.calculatePlayerStats(users, boards, 1);
                    for (const [key, value] of result) sink += key.length + Buffer.byteLength(JSON.stringify(value));
                }
                const used = process.cpuUsage(cpu);
                rounds[name].push((used.user + used.system) / 1000);
            }
        }
        assert.ok(sink > 0);
        const median = name => rounds[name].slice().sort((a, b) => a - b)[3];
        console.log(JSON.stringify({users: users.length, active: 100, referenceCpuMs: median('reference'), currentCpuMs: median('current'), rounds}));
    }
} finally {await dispose();}
