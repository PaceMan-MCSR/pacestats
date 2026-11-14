/** Read-only helper benchmark; start a fresh process for each sample. */
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

if (process.env.PERF_LOCAL_DOCKER !== '1' || !['127.0.0.1', 'localhost', 'mysql'].includes(process.env.DB_HOST)) {
    throw new Error('Run this read-only benchmark inside the local Docker environment with PERF_LOCAL_DOCKER=1.');
}
const root = process.env.PERF_SOURCE_ROOT ?? process.cwd();
const data = await import(pathToFileURL(resolve(root, 'app/data.ts')).href);
const uuid = process.env.PERF_UUID ?? 'e4cd494a-4e0a-423b-9988-618b86858c96';
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/data.json';
const results = [];
async function measure(name, work) {
    global.gc?.();
    const before = process.memoryUsage();
    const cpu = process.cpuUsage();
    let peakRss = before.rss;
    const sampler = setInterval(() => {peakRss = Math.max(peakRss, process.memoryUsage().rss);}, 5);
    const started = performance.now();
    try {
        const value = await work();
        const durationMs = Math.round((performance.now() - started) * 10) / 10;
        const after = process.memoryUsage();
        const usedCpu = process.cpuUsage(cpu);
        const json = JSON.stringify(value);
        const canonical = JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
        const result = {
            name, durationMs,
            cpuMs: Math.round((usedCpu.user + usedCpu.system) / 100) / 10,
            heapDeltaMiB: Math.round((after.heapUsed - before.heapUsed) / 104857.6) / 10,
            peakRssMiB: Math.round(Math.max(peakRss, after.rss) / 104857.6) / 10,
            resultBytes: Buffer.byteLength(json), sha256: createHash('sha256').update(canonical).digest('hex'),
        };
        results.push(result);
        console.log(JSON.stringify(result));
    } finally {clearInterval(sampler);}
}
try {
    await measure('filtered PB: one player', () => data.getPBs([], [uuid]));
    await measure('run grid: first 25', () => data.getPlayerRunsOffsetPage(uuid, 0, 25, [], {column: 'date', direction: 'desc'}));
    await measure('run grid: next 25', () => data.getPlayerRunsOffsetPage(uuid, 1, 25, [], {column: 'date', direction: 'desc'}));
    await measure('profile: recent four', () => data.getPlayerRuns(uuid, 4));
    await measure('tracker: recent 100', () => data.getRecentNethers(uuid, 100));
    await measure('front: lifetime boards', () => data.getTrimmedLeaderboards(9999));
} finally {
    await mkdir(dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify({generatedAt: new Date().toISOString(), sourceRoot: root, uuid, results}, null, 2));
    // data.ts owns pooled MySQL/Redis handles, so this standalone tool explicitly exits.
}
process.exit(0);
