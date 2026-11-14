/** Check local production routes with either warm or entirely empty Redis. */
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const base = new URL(process.env.PERF_BASE_URL ?? 'http://127.0.0.1:5053/stats/');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Local Docker server required');
const cold = process.env.PERF_EMPTY_REDIS === '1';
const uuid = 'e4cd494a-4e0a-423b-9988-618b86858c96';
const player = 'NoFearr1337';
const results = [];
async function check(path, status, verify) {
    const started = performance.now();
    const response = await fetch(new URL(path, base), {signal: AbortSignal.timeout(30_000)});
    const body = await response.text();
    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    assert.equal(response.status, status, `${path}: ${body.slice(0, 300)}`);
    await verify?.(body, response);
    const result = {path, status: response.status, durationMs, responseBytes: Buffer.byteLength(body)};
    results.push(result);
    console.log(JSON.stringify(result));
}
await check('?days=9999', 200, body => assert.ok(body.includes(cold ? 'Retry leaderboards' : 'Nether Enters')));
await check(`player/${player}/?days=9999`, 200, body => {
    assert.ok(body.includes(`Stats for ${player}`));
    assert.ok(body.includes('Nether Enters'));
    assert.ok(!body.includes('An error has occurred'));
});
await check(`api/getPlayerRuns/?uuid=${uuid}&page=0&pageSize=25`, 200, body => {
    const data = JSON.parse(body);
    assert.equal(data.rows.length, 25);
    assert.ok(data.rowCount >= 21_593);
});
await check(`api/getPBs/?uuids=${uuid}`, 200, body => assert.equal(JSON.parse(body).length, 1));
await check(`api/getPlayerInfo/?names=${player}`, 200, body => assert.equal(JSON.parse(body)[player.toLowerCase()].id, uuid));
await check('api/getLeaderboard/?days=9999&category=nether&type=average&limit=10', cold ? 503 : 200, (body, response) => {
    if (cold) {
        assert.equal(JSON.parse(body).code, 'CACHE_NOT_READY');
        assert.ok(Number(response.headers.get('Retry-After')) > 0);
        assert.ok(response.headers.get('Cache-Control').includes('no-store'));
    } else assert.equal(JSON.parse(body).length, 10);
});
await check('api/getFastest/?days=9999&category=nether&limit=10', cold ? 503 : 200);
await check(`api/getPlayerRuns/?uuid=${uuid}&page=0&pageSize=99999`, 400);
await check(`api/getPlayerRuns/?uuid=${uuid}&page=0&sort=unsupported`, 400);
const output = process.env.PERF_OUTPUT ?? '/app/test-artifacts/performance/http.json';
await mkdir(dirname(output), {recursive: true});
await writeFile(output, JSON.stringify({generatedAt: new Date().toISOString(), baseUrl: base.href, emptyRedis: cold, results}, null, 2));
