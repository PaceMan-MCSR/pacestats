import assert from 'node:assert/strict';
import {readHashPages, readDigestLedger} from '../scripts/cache-runtime.ts';

const calls = [];
const pages = [['27', ['first', 'a']], ['9', []], ['0', ['second', 'b', 'first', 'a']]];
const redis = {async hscan(...args) {calls.push(args); return pages[calls.length - 1];}};
const result = await readDigestLedger(redis, 'ledger');
assert.deepEqual([...result.previous], [['first', 'a'], ['second', 'b']]);
assert.equal(result.changed.size, 0);
assert.deepEqual(calls, [['ledger', '0', 'COUNT', 500], ['ledger', '27', 'COUNT', 500], ['ledger', '9', 'COUNT', 500]]);
let consumed = 0;
await readHashPages({async hscan() {return ['0', []];}}, 'absent', entries => {consumed++; assert.deepEqual(entries, []);});
assert.equal(consumed, 1);
await assert.rejects(readHashPages({async hscan() {throw new Error('transport');}}, 'broken', () => {}), /transport/);
console.log('Hash paging: cursor/empty pages, duplicate fields, absent hash and transport failure passed.');

if (process.env.PERF_BENCHMARK === '1') {
    const count = 100_000;
    const fake = {
        async hgetall() {return Object.fromEntries(Array.from({length: count}, (_, index) => [`target-${index}`, `digest-${index}`]));},
        async hscan(_key, cursor, _option, batch) {
            const offset = Number(cursor);
            const end = Math.min(count, offset + batch);
            const entries = [];
            for (let index = offset; index < end; index++) entries.push(`target-${index}`, `digest-${index}`);
            return [end === count ? '0' : String(end), entries];
        },
    };
    const start = process.cpuUsage();
    const ledger = process.env.PERF_VARIANT === 'legacy'
        ? {previous: new Map(Object.entries(await fake.hgetall()))}
        : await readDigestLedger(fake, 'ledger');
    assert.equal(ledger.previous.size, count);
    const used = process.cpuUsage(start);
    console.log(JSON.stringify({variant: process.env.PERF_VARIANT ?? 'paged', fields: count,
        cpuMs: (used.user + used.system) / 1000, peakRssMiB: process.resourceUsage().maxRSS / 1024}));
}
