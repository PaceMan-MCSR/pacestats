/** Docker: node --import tsx tests/time-formatting.ts [--bench] */
import assert from 'node:assert/strict';
import {formatDecimals, formatTime} from '../app/utils';

const legacyTime = (value: any, truncate = true) => new Date(Number.parseFloat(value))
    .toISOString().slice(11, truncate ? 19 : 21).replace(/^(?:00:)?0?/, '');
const legacyDecimals = (value: any, dp = 0) => {
    const result = new Date(Number.parseFloat(value)).toISOString().slice(14, 19 + (dp > 0 ? dp + 1 : 0));
    return result.startsWith('0') ? result.slice(1) : result;
};
const outcome = (fn: () => string) => {
    try {return {value: fn()};} catch (error) {return {error: (error as Error).constructor.name};}
};
let seed = 0x12345678;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000);
const values: any[] = [null, undefined, NaN, Infinity, -Infinity, -0, -1, -1000, 0, .99, 99.99, 999.999,
    1000, 59999, 60000, 3599999, 3600000, 86399999.999, 86400000, 86400001, 1e12, 8.64e15, 8.64e15 + 1,
    '', 'abc', '1:30', ' 120650.99ms', '-123.5', [], {}, true, 123n];
for (let i = 0; i < 5_000; i++) values.push(random() * 86_400_000);
for (const value of values) {
    for (const truncate of [true, false]) assert.deepEqual(outcome(() => formatTime(value, truncate)), outcome(() => legacyTime(value, truncate)));
    for (const dp of [-1, 0, .5, 1, 2, 3, 4, 8, NaN]) assert.deepEqual(outcome(() => formatDecimals(value, dp)), outcome(() => legacyDecimals(value, dp)));
}
console.log(`PASS: ${values.length} duration inputs preserve exact text and errors across formatting/precision modes`);

if (process.argv.includes('--bench')) {
    const splits = Array.from({length: 10_000}, () => Math.floor(random() * 3_600_000));
    const measure = (fn: (value: number) => string) => {
        const started = performance.now(), cpu = process.cpuUsage();
        let checksum = 0;
        for (let round = 0; round < 30; round++) for (const value of splits) {
            const text = fn(value);
            checksum += text.length + text.charCodeAt(text.length - 1);
        }
        const used = process.cpuUsage(cpu);
        return {ms: performance.now() - started, cpuMs: (used.user + used.system) / 1000, checksum};
    };
    for (let round = 0; round < 4; round++) {
        const before = measure(value => legacyTime(value, false));
        const after = measure(value => formatTime(value, false));
        assert.equal(before.checksum, after.checksum);
        console.log(JSON.stringify({round, before, after}));
    }
}
