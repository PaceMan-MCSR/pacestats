import assert from 'node:assert/strict';
import {readFile, readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const directory = process.env.PERF_SAMPLES_DIR ?? '/app/test-artifacts/performance';
const files = await readdir(directory);
async function samples(prefix) {
    const names = files.filter(name => new RegExp(`^${prefix}-browser-\\d+\\.json$`).test(name)).sort();
    assert.ok(names.length >= 3, `At least three ${prefix} browser samples required`);
    const runs = await Promise.all(names.map(async name => JSON.parse(await readFile(join(directory, name), 'utf8'))));
    for (const run of runs) {
        assert.equal(run.latencyMs, 300);
        assert.equal(run.cpuSlowdown, 4);
        assert.equal(run.results.length, 15, 'Partial browser sample');
        assert.deepEqual(run.errors, []);
    }
    return runs;
}
const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const baseline = await samples('baseline');
const final = await samples('final');
const seen = new Set();
const results = baseline[0].results.map((row, index) => {
    for (const run of [...baseline, ...final]) assert.equal(run.results[index].name, row.name);
    const name = `${row.name}${seen.has(row.name) ? ' (return)' : ''}`;
    seen.add(row.name);
    const beforeMs = median(baseline.map(run => run.results[index].readyMs));
    const afterMs = median(final.map(run => run.results[index].readyMs));
    return {
        name, baselineMs: beforeMs, finalMs: afterMs,
        changePercent: Math.round((afterMs / beforeMs - 1) * 1000) / 10,
        baselineRequests: median(baseline.map(run => run.results[index].localRequests)),
        finalRequests: median(final.map(run => run.results[index].localRequests)),
    };
});
const summary = {generatedAt: new Date().toISOString(), baselineSamples: baseline.length, finalSamples: final.length, results};
await writeFile(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
