/**
 * Checks that the single-pass trimmed average returns exactly the value the
 * original sort-based code returned, then times both on the same data.
 *
 *     npm run verify:trimmed-average
 */
import assert from "node:assert/strict";
import { calculateAvg, keptCount, trimmedStats, trimmedStatsBySorting } from "@/app/trimmedAverage";

// Verbatim copies of the two implementations this replaced.
function legacyDataAvg(data: number[]): number {
    if (data == null || data.length === 0) return 0;
    data = data.sort((a, b) => a - b);
    const length = data.length;
    const p98 = length >= 50 ? Math.floor(length * 0.98) : length;
    return data.slice(0, p98).reduce((a, b) => a + b, 0) / p98 || 0;
}

function legacyCacheAvgInPlace(data: number[]): number {
    if (!data || data.length === 0) return 0;
    data.sort((a, b) => a - b);
    const p98 = data.length >= 50 ? Math.floor(data.length * 0.98) : data.length;
    let sum = 0;
    for (let index = 0; index < p98; index++) sum += data[index];
    return sum / p98 || 0;
}

// Deterministic generator so a failure can be reproduced.
let seed = 0x9e3779b9;
function random(): number {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const shapes: Record<string, (length: number) => number[]> = {
    // Typical split times in milliseconds.
    splits: (length) => Array.from({length}, () => 60_000 + Math.floor(random() * 240_000)),
    // A few very slow runs, the case the trim exists for.
    outliers: (length) => Array.from({length}, () => (
        random() < 0.03 ? 3_000_000 + Math.floor(random() * 50_000_000) : 90_000 + Math.floor(random() * 30_000)
    )),
    // Many equal values, including ties across the 98% boundary.
    ties: (length) => Array.from({length}, () => 100_000 + Math.floor(random() * 4) * 1_000),
    same: (length) => Array.from({length}, () => 123_456),
    ascending: (length) => Array.from({length}, (_, index) => 1_000 + index * 7),
    descending: (length) => Array.from({length}, (_, index) => 1_000 + (length - index) * 7),
    zeros: (length) => Array.from({length}, () => (random() < 0.5 ? 0 : Math.floor(random() * 10))),
    // Inputs the single pass cannot total exactly; they take the sorting path.
    fractional: (length) => Array.from({length}, () => random() * 300_000),
    negative: (length) => Array.from({length}, () => Math.floor(random() * 2_000) - 1_000),
    enormous: (length) => Array.from({length}, () => Math.floor(random() * 2 ** 52)),
};

function check(name: string, values: number[]): void {
    const expected = legacyDataAvg([...values]);
    const sorted = [...values];
    const expectedCache = legacyCacheAvgInPlace(sorted);
    assert.ok(Object.is(expected, expectedCache), `${name}: the two legacy versions disagree`);

    const before = [...values];
    const stats = trimmedStats(values);
    assert.deepEqual(values, before, `${name}: input was reordered`);
    const label = `${name} (length ${values.length})`;
    assert.ok(Object.is(stats.avg, expected), `${label}: avg ${stats.avg} !== ${expected}`);
    assert.ok(Object.is(calculateAvg(values), expected), `${label}: calculateAvg differs`);
    assert.equal(stats.count, values.length, `${label}: count`);
    assert.equal(stats.kept, keptCount(values.length), `${label}: kept`);
    if (values.length > 0) assert.ok(Object.is(stats.min, sorted[0]), `${label}: min ${stats.min} !== ${sorted[0]}`);
    assert.deepEqual(trimmedStatsBySorting(values), stats, `${label}: sorting path differs`);
}

let checked = 0;
assert.equal(calculateAvg(null), 0);
assert.equal(calculateAvg(undefined), 0);
for (const [name, make] of Object.entries(shapes)) {
    // Every length around the 50-value threshold and each point where one more
    // value starts being dropped, then a spread of larger series.
    for (let length = 0; length <= 400; length++) { check(name, make(length)); checked++; }
    for (let round = 0; round < 150; round++) { check(name, make(400 + Math.floor(random() * 60_000))); checked++; }
}
console.log(`Equality: ${checked} series matched the legacy result exactly (avg, count, fastest).`);

// A leaderboard-shaped dataset: many players, a long tail of small series, and
// a few very large ones, each with ten split categories.
const players: number[][][] = [];
let totalValues = 0;
for (let player = 0; player < 6_000; player++) {
    const size = Math.floor(8 / (random() ** 1.6 + 0.0004));
    const categories: number[][] = [];
    for (let category = 0; category < 10; category++) {
        const length = Math.max(0, Math.floor(size / (1 + category * category)));
        categories.push(shapes.outliers(length));
        totalValues += length;
    }
    players.push(categories);
}

function board(avg: (values: number[]) => {qty: number; avg: number; fastest: number}): string {
    const rows: Array<{player: number; category: number; qty: number; avg: number; fastest: number}> = [];
    for (let player = 0; player < players.length; player++) {
        for (let category = 0; category < 10; category++) {
            const values = players[player][category];
            if (values.length === 0) continue;
            rows.push({player, category, ...avg([...values])});
        }
    }
    rows.sort((a, b) => a.category - b.category || a.avg - b.avg || b.qty - a.qty || a.player - b.player);
    return JSON.stringify(rows);
}

const legacyBoard = board((values) => {
    const qty = values.length;
    const avg = legacyCacheAvgInPlace(values);
    return {qty, avg, fastest: values[0]};
});
const currentBoard = board((values) => {
    const stats = trimmedStats(values);
    return {qty: stats.count, avg: stats.avg, fastest: stats.min};
});
assert.equal(currentBoard, legacyBoard, "leaderboard output differs");
console.log(`Equality: leaderboard built from ${players.length} players / ${totalValues} values is byte-identical.`);

function time(work: () => void, rounds: number): number {
    let best = Infinity;
    for (let round = 0; round < rounds; round++) {
        const startedAt = performance.now();
        work();
        best = Math.min(best, performance.now() - startedAt);
    }
    return best;
}

console.log("\nSpeed (best of several rounds, each call gets a fresh unsorted copy):");
console.log("  series length |   legacy sort |  single pass | speedup");
for (const length of [10, 49, 50, 200, 1_000, 10_000, 100_000, 1_000_000]) {
    const calls = Math.max(3, Math.floor(2_000_000 / length));
    const source = shapes.outliers(length);
    const copies = () => Array.from({length: calls}, () => [...source]);
    let sink = 0;
    let batch = copies();
    const legacy = time(() => { for (const values of batch) sink += legacyCacheAvgInPlace(values); batch = copies(); }, 5);
    const copyOnly = time(() => { batch = copies(); }, 5);
    const current = time(() => { for (const values of batch) sink += trimmedStats(values).avg; }, 5);
    const legacyNet = Math.max(legacy - copyOnly, 0.0001);
    console.log(
        `  ${String(length).padStart(13)} | ${(legacyNet / calls * 1000).toFixed(3).padStart(10)} µs`
        + ` | ${(current / calls * 1000).toFixed(3).padStart(9)} µs | ${(legacyNet / current).toFixed(1)}x`,
    );
    if (!Number.isFinite(sink)) throw new Error("unexpected result");
}

const legacyTotal = time(() => board((values) => ({qty: values.length, avg: legacyCacheAvgInPlace(values), fastest: values[0]})), 5);
const currentTotal = time(() => board((values) => { const s = trimmedStats(values); return {qty: s.count, avg: s.avg, fastest: s.min}; }), 5);
console.log(`\nLeaderboard build over ${totalValues} values: legacy ${legacyTotal.toFixed(1)} ms, single pass ${currentTotal.toFixed(1)} ms.`);
