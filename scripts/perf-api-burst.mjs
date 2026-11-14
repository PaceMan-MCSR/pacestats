/** Local Docker cold-request burst. Use a fresh production server and isolated empty Redis. */
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {execFileSync} from 'node:child_process';

const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5083/stats/');
assert.ok(existsSync('/.dockerenv') && ['127.0.0.1','localhost','[::1]'].includes(base.hostname), 'Local Docker only');
const pid = Number(process.env.PERF_SERVER_PID);
assert.ok(Number.isSafeInteger(pid) && pid > 1, 'Set PERF_SERVER_PID to the isolated Next server PID');
const ticksPerSecond = Number(execFileSync('getconf',['CLK_TCK'],{encoding:'utf8'}).trim());
const sample = async () => {
    const [stat,status] = await Promise.all([readFile(`/proc/${pid}/stat`,'utf8'),readFile(`/proc/${pid}/status`,'utf8')]);
    const fields = stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
    return {cpuTicks:Number(fields[11])+Number(fields[12]), rssMiB:Number(status.match(/^VmRSS:\s+(\d+)/m)[1])/1024};
};
const uuid = 'e4cd494a-4e0a-423b-9988-618b86858c96';
const name = 'NoFearr1337';
const paths = [
    ...Array.from({length:8},(_,i) => `api/${i%2 ? 'getNPH':'getSessionStats'}/?name=${name}&hours=${239976-i}&hoursBetween=239976`),
    ...Array.from({length:4},(_,i) => `api/getRunsPaginated/?page=${100+i}&pageSize=10000`),
    ...Array.from({length:4},(_,i) => `api/getPlayerRuns/?uuid=${uuid}&page=${i}&pageSize=25`),
    `api/getPBs/?uuids=${uuid}`, `api/getLatestCompletion/?name=${name}`,
];
async function request(path) {
    const start = performance.now();
    const response = await fetch(new URL(path,base),{signal:AbortSignal.timeout(30_000)});
    const text = await response.text();
    assert.ok([200,429].includes(response.status),`${path}: ${response.status} ${text.slice(0,200)}`);
    JSON.parse(text);
    if(response.status === 429) {
        assert.ok(Number(response.headers.get('retry-after')) > 0);
        assert.ok(response.headers.get('cache-control').includes('no-store'));
    }
    return {path,status:response.status,durationMs:Math.round((performance.now()-start)*10)/10,responseBytes:Buffer.byteLength(text)};
}
const before = await sample();
let peakRss = before.rssMiB, sampling = false;
const timer = setInterval(async () => {
    if(sampling) return;
    sampling = true;
    try {peakRss = Math.max(peakRss,(await sample()).rssMiB);} finally {sampling = false;}
},10);
let results, after, elapsedMs;
const started = performance.now();
try {
    results = await Promise.all(paths.map(request));
    after = await sample();
    elapsedMs = performance.now()-started;
} finally {clearInterval(timer);}
// Verify busy request slots were released, including the two namespaces shared
// by the large requests, without forcing a retry sleep or accepting a 500.
for(const path of [paths[0],paths[8]]) assert.equal((await request(path)).status,200);
const result = {generatedAt:new Date().toISOString(),baseUrl:base.href,pid,requests:paths.length,
    elapsedMs:Math.round(elapsedMs*10)/10,
    cpuMs:(after.cpuTicks-before.cpuTicks)/ticksPerSecond*1000,
    startRssMiB:before.rssMiB,peakRssMiB:Math.max(peakRss,after.rssMiB),
    accepted:results.filter(value => value.status===200).length,busy:results.filter(value => value.status===429).length,
    results,limits:'One diagnostic burst; process RSS sampled every 10ms, not total Docker memory or a CPU utilization ceiling'};
assert.ok(result.accepted > 0 && result.busy > 0, 'Exercise useful work and overload protection');
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/round3/api-burst.json';
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
