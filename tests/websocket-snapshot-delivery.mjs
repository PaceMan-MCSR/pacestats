/** Docker-only real sockets/PubSub; the private HTTP fixture counts backend work. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createServer as createTcpServer} from 'node:net';
import {once} from 'node:events';
import Redis from 'ioredis';
import {WebSocket} from 'ws';
assert.ok(existsSync('/.dockerenv'), 'Use local Docker');
const waitFor = async (condition, description) => {
    const deadline = Date.now() + 5_000;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};
const reserve = createTcpServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
const requests = [], holds = new Map();
let fail = false;
const upstream = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const query = url.searchParams;
    assert.equal(req.headers.authorization, 'Bearer local-snapshot-token');
    requests.push({query: query.toString(), kind: query.get('kind'), name: query.get('name'), hours: query.get('hours')});
    const send = () => {
        if (fail) { res.writeHead(503); res.end('{}'); return; }
        const uuids = (query.get('names') || query.get('name')).split(',').map(name => `uuid-${name}`);
        const data = {count: Number(query.get('hours')), avg: '1:23', uuid: uuids[0]};
        res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({data, uuids}));
    };
    if (holds.has(query.toString())) holds.set(query.toString(), send); else send();
});
upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
const endpoint = `http://127.0.0.1:${upstream.address().port}/stats/api/obsSnapshot/`;
const channel = `pacestats:overlay-test:${randomUUID()}`;
const child = spawn('node', ['ws/index.mjs'], {cwd: process.cwd(), env: {...process.env,
    WS_PORT: String(port), WS_REDIS_CHANNEL: channel, WS_TOKEN: 'local-snapshot-token',
    WS_ALLOWED_ORIGINS: 'http://localhost:5050', WS_COALESCE_MS: '30', WS_SNAPSHOT_ENDPOINT: endpoint,
    DOTENV_CONFIG_PATH: '/dev/null'}, stdio: ['ignore', 'pipe', 'pipe']});
let logs = '';
child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
const redis = new Redis(process.env.REDIS_URL), clients = [];
const connect = async query => {
    const path = query.startsWith('pull/') ? query : `overlay?${query}`;
    const client = new WebSocket(`ws://127.0.0.1:${port}/${path}`, {origin: 'http://localhost:5050'});
    client.messages = [];
    client.on('message', data => client.messages.push(String(data)));
    clients.push(client); await once(client, 'open'); return client;
};
const snapshots = client => client.messages.filter(message => message.startsWith('{')).map(message => JSON.parse(message));
const publish = uuid => redis.publish(channel, JSON.stringify({uuid}));
try {
    await waitFor(() => logs.includes('listening on port') && logs.includes('Subscribed to Redis channel'), `startup: ${logs}`);
    const base = 'kind=nethers&name=a&hours=24&nph=false';
    const a = await Promise.all(Array.from({length: 30}, () => connect(base)));
    await waitFor(() => a.every(client => snapshots(client).length === 1), 'initial shared snapshot');
    assert.equal(requests.length, 1, 'Thirty OBS clients share one backend request');
    assert.ok(a.every(client => snapshots(client)[0].data.count === 24));
    const canonical = await connect('name=a&kind=nethers&hours=024&nph=false');
    await waitFor(() => snapshots(canonical).length === 1, 'canonical loaded subscription');
    assert.equal(requests.length, 1);
    const b = await connect('kind=nethers&name=b&hours=24');
    const different = await connect('kind=nethers&name=a&hours=48');
    const combined = await connect('kind=combinedNethers&names=a,b&hours=72');
    const legacy = await connect('pull/uuid-a');
    await waitFor(() => [b, different, combined].every(client => snapshots(client).length === 1), 'independent variants');
    assert.equal(requests.length, 4);
    await Promise.all(Array.from({length: 50}, () => publish('uuid-a')));
    await waitFor(() => a.every(client => snapshots(client).length === 2)
        && snapshots(different).length === 2 && snapshots(combined).length === 2 && legacy.messages.length === 1,
    'coalesced per-variant fanout');
    assert.equal(requests.length, 7, 'One UUID event reads each affected variant once');
    assert.equal(snapshots(b).length, 1, 'Other UUID is isolated');
    assert.deepEqual(legacy.messages, ['refresh'], 'Legacy pull keeps the bare-string protocol');
    assert.ok(a.every(client => client.messages[1] === a[0].messages[1]), 'One serialized result fans out unchanged');
    await publish('uuid-b');
    await waitFor(() => snapshots(b).length === 2 && snapshots(combined).length === 3, 'combined second UUID');
    assert.equal(requests.length, 9);

    const key = requests.find(request => request.name === 'a' && request.hours === '24').query;
    holds.set(key, null);
    await publish('uuid-a');
    await waitFor(() => typeof holds.get(key) === 'function', 'held in-flight snapshot');
    const before = a[0].messages.length;
    await redis.publish(channel, JSON.stringify({uuid: 'uuid-a', type: 'reloadPage'}));
    await waitFor(() => a[0].messages.at(-1) === 'reloadPage', 'reload delivery');
    holds.get(key)(); holds.delete(key);
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(a[0].messages.length, before + 1, 'Aborted old HTTP result cannot overwrite reload');
    assert.equal(a[0].messages.at(-1), 'reloadPage');

    // One failure transition enables browser fallback. Joining an errored group
    // is served that signal without bypassing the shared retry backoff.
    fail = true;
    await publish('uuid-a');
    await waitFor(() => [a[0], different, combined].every(client => client.messages.at(-1).includes('snapshot-error')), 'fallback signal');
    const afterFailure = requests.length;
    const failedJoin = await connect(base);
    await waitFor(() => failedJoin.messages.some(message => message.includes('snapshot-error')), 'failed-group join');
    await Promise.all(Array.from({length: 50}, () => publish('uuid-a')));
    await new Promise(resolve => setTimeout(resolve, 80));
    assert.equal(requests.length, afterFailure, 'An upstream outage obeys per-variant retry backoff');
    console.log('PASS: 30 real OBS sockets share one backend read; canonical variants, UUID/combined isolation, PubSub fanout, legacy delivery, reload ordering and outage backoff');
} finally {
    for (const client of clients) client.terminate();
    await redis.quit();
    const exit = once(child, 'exit'); child.kill('SIGTERM');
    const kill = setTimeout(() => child.kill('SIGKILL'), 5_000); kill.unref();
    await exit; clearTimeout(kill);
    upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve));
}
