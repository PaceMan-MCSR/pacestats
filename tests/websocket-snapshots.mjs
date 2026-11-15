/** Docker-only deterministic scheduling, transport and resource-bound checks. */
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {SnapshotBroker} from '../ws/snapshot-broker.mjs';
import {SnapshotDelivery} from '../ws/snapshot-delivery.mjs';
import {createSnapshotFetcher, parseSnapshotSubscription} from '../ws/snapshot-subscription.mjs';
assert.ok(existsSync('/.dockerenv'), 'Use local Docker');
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return {promise, resolve, reject};
};
const spec = query => parseSnapshotSubscription(new URLSearchParams(query));
const normal = spec('kind=session&name=fixture');
const output = (count = 1, uuids = ['fixture-uuid']) => ({data: {nether: {count, avg: '1:23'}}, uuids});
const clock = () => {
    let now = 0, nextId = 0;
    const timers = new Map();
    return {timers, now: () => now,
        schedule: (fn, delay) => { const id = ++nextId; timers.set(id, {fn, at: now + delay}); return id; },
        cancel: id => timers.delete(id),
        advance: async ms => {
            now += ms;
            for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
            await settle();
        }};
};

assert.equal(normal.key, spec('name=fixture&kind=session&hours=024&hoursBetween=006&dp=2&font=Arial').key);
assert.equal(spec('kind=nethers&name=fixture').params.get('nph'), 'true');
assert.equal(spec('kind=nethers&name=fixture&nph=false').params.get('nph'), 'false');
assert.equal(spec('kind=session&name=fixture&hours=9999999').params.get('hours'), '239976');
assert.equal(spec('kind=combinedNethers&names= fixture , other ').params.get('names'), 'fixture,other');
for (const query of ['kind=unknown&name=x', 'kind=session', 'kind=session&name=x&hours=0',
    'kind=session&name=x&hours=NaN', 'kind=combinedStats&names=x&hoursBetween=0',
    'kind=nethers&name=x&dp=4', 'kind=nethers&name=x&nph=yes', 'kind=nethers&name=x&liveOnly=1',
    `kind=combinedStats&names=${Array(21).fill('x').join(',')}`, 'kind=combinedStats&names=x&start=9007199254740992']) {
    assert.throws(() => spec(query), undefined, query);
}

{
    const time = clock(), reads = [], delivered = [];
    const broker = new SnapshotBroker({...time, fetchSnapshot: () => {
        const read = deferred(); reads.push(read); return read.promise;
    }, send: (client, message) => delivered.push([client, message])});
    const a = {}, b = {}, c = {};
    assert.ok(broker.add(a, normal)); assert.ok(broker.add(b, normal));
    assert.equal(reads.length, 1, 'Identical in-flight subscriptions share one read');
    reads[0].resolve(output()); await settle();
    assert.equal(delivered.length, 2);
    assert.deepEqual(JSON.parse(delivered[0][1]), {type: 'snapshot', version: 1, sequence: 1, data: output().data});
    assert.ok(broker.add(c, normal));
    assert.equal(reads.length, 1, 'Loaded active group supplies its retained snapshot');
    assert.equal(delivered.length, 3);
    assert.equal(time.timers.size, 1, 'All groups use one freshness timer');
    broker.notify('unrelated'); assert.equal(reads.length, 1);
    broker.notify('fixture-uuid'); assert.equal(reads.length, 2);
    for (let i = 0; i < 100; i++) broker.notify('fixture-uuid');
    reads[1].resolve(output(2)); await settle();
    assert.equal(reads.length, 3, 'Events during a read require one following read');
    reads[2].resolve(output(3)); await settle();
    assert.equal(JSON.parse(delivered.at(-1)[1]).sequence, 3);
    await time.advance(29_999); assert.equal(reads.length, 3);
    await time.advance(1); assert.equal(reads.length, 4, 'Rolling windows refresh with no ingest event');
    reads[3].resolve(output(4)); await settle();
    broker.remove(a); broker.remove(b); broker.remove(c);
    assert.equal(broker.groups.size, 0); assert.equal(broker.byUuid.size, 0);
    assert.equal(broker.byClient.size, 0); assert.equal(time.timers.size, 0);
    broker.clear();
}

{
    const time = clock(), reads = [], delivered = [];
    const broker = new SnapshotBroker({...time, fetchSnapshot: (_spec, signal) => {
        const read = {...deferred(), signal}; reads.push(read); return read.promise;
    }, send: (_client, message) => delivered.push(message)});
    const client = {};
    broker.add(client, normal);
    broker.notify('fixture-uuid'); // identity has not resolved yet
    reads[0].resolve(output()); await settle();
    assert.equal(reads.length, 2, 'Initial identity/event race requires a registered rerun');
    reads[1].resolve(output(2)); await settle();
    broker.notify('fixture-uuid'); assert.equal(reads.length, 3);
    broker.notify('fixture-uuid', 'reloadPage');
    assert.equal(reads[2].signal.aborted, true);
    const before = delivered.length;
    broker.notify('fixture-uuid'); // refresh after reload, while the old read settles
    reads[2].resolve(output(999)); await settle();
    assert.equal(reads.length, 4);
    assert.equal(delivered.length, before, 'Reload blocks an older in-flight result');
    assert.equal(delivered.at(-1), 'reloadPage');
    reads[3].resolve(output(4)); await settle();
    assert.equal(JSON.parse(delivered.at(-1)).data.nether.count, 4);
    broker.notify('fixture-uuid');
    broker.remove(client); assert.equal(reads.at(-1).signal.aborted, true);
    const after = delivered.length;
    reads.at(-1).resolve(output(777)); await settle();
    assert.equal(delivered.length, after, 'Disconnect discards a result even if fetch ignores abort');
    assert.equal(time.timers.size, 0);
    broker.clear();
}

{
    const time = clock(), reads = [], messages = [];
    const broker = new SnapshotBroker({...time, maxGroups: 3, maxClientsPerGroup: 2, concurrency: 2,
        fetchSnapshot: () => { const read = deferred(); reads.push(read); return read.promise; },
        send: (_client, message) => messages.push(message)});
    const clients = Array.from({length: 6}, () => ({}));
    assert.ok(broker.add(clients[0], normal)); assert.ok(broker.add(clients[1], normal));
    assert.equal(broker.add(clients[2], normal), false, 'Per-group subscription count is bounded');
    const second = spec('kind=nethers&name=fixture'), third = spec('kind=session&name=other');
    broker.add(clients[2], second); broker.add(clients[3], third);
    assert.equal(broker.add(clients[4], spec('kind=session&name=fourth')), false);
    assert.equal(broker.active, 2); assert.equal(broker.pending.size, 1);
    reads[0].resolve(output()); await settle();
    assert.equal(reads.length, 3); assert.equal(broker.active, 2);
    reads[1].reject(new Error('temporary failure')); reads[2].resolve(output(1, ['other-uuid'])); await settle();
    assert.ok(messages.includes('{"type":"snapshot-error","version":1}'));
    for (let i = 0; i < 100; i++) broker.notify('fixture-uuid');
    // The healthy session group starts once; the failed nethers group obeys backoff.
    assert.equal(reads.length, 4);
    reads[3].resolve(output(2)); await settle();
    assert.equal(reads.length, 5, 'In-flight healthy invalidations coalesce into one rerun');
    reads[4].resolve(output(3)); await settle();
    const errors = messages.filter(message => message.includes('snapshot-error')).length;
    await time.advance(5_000); assert.equal(reads.length, 6);
    reads[5].reject(new Error('still unavailable')); await settle();
    assert.equal(messages.filter(message => message.includes('snapshot-error')).length, errors,
        'Repeated upstream failure does not repeatedly trigger browser fallback');
    broker.clear(); assert.equal(time.timers.size, 0); assert.equal(broker.pending.size, 0);
}

{
    const callbacks = [], cancelled = new Set(), sent = [];
    const delivery = new SnapshotDelivery((client, message) => sent.push([client, message]), {
        defer: callback => { callbacks.push(callback); return callbacks.length - 1; }, cancel: id => cancelled.add(id)});
    const clients = Array.from({length: 1_000}, () => ({}));
    for (const client of clients) { delivery.add(client, 'old'); delivery.add(client, 'latest'); }
    delivery.add(clients[0], 'reloadPage'); delivery.add(clients[0], 'newer');
    delivery.remove(clients[1]);
    assert.equal(callbacks.length, 1); assert.equal(delivery.pending.size, 999);
    callbacks[0](); assert.equal(sent.length, 256);
    assert.equal(sent[0][1], 'reloadPage'); assert.equal(sent[1][1], 'latest');
    callbacks[1](); assert.equal(sent.length, 512);
    delivery.clear(); assert.equal(delivery.pending.size, 0); assert.ok(cancelled.has(2));
}

{
    const controller = new AbortController();
    let request;
    const fetcher = createSnapshotFetcher({endpoint: 'http://127.0.0.1:5050/stats/api/obsSnapshot', token: 'fixture-token',
        fetchImpl: async (url, options) => { request = {url, options}; return new Response(JSON.stringify(output())); }});
    assert.deepEqual(await fetcher(normal, controller.signal), output());
    assert.equal(request.options.headers.authorization, 'Bearer fixture-token');
    assert.equal(request.options.redirect, 'error'); assert.equal(request.options.cache, 'no-store');
    assert.equal(request.url.searchParams.get('kind'), 'session');
    assert.equal(request.options.signal.aborted, false);
    controller.abort(); assert.equal(request.options.signal.aborted, true);
    for (const response of [new Response('x', {status: 503}),
        new Response('x', {headers: {'content-length': '999999'}}),
        new Response('x'.repeat(33_000)), new Response('{invalid')]) {
        const invalid = createSnapshotFetcher({endpoint: 'http://localhost/snapshot', token: 'fixture', fetchImpl: async () => response});
        await assert.rejects(invalid(normal, new AbortController().signal));
    }
    let cancelled = false;
    const oversized = new Response(new ReadableStream({start(stream) {stream.enqueue(new Uint8Array(33_000));},
        cancel() {cancelled = true;}}));
    const invalid = createSnapshotFetcher({endpoint: 'http://localhost/snapshot', token: 'fixture', fetchImpl: async () => oversized});
    await assert.rejects(invalid(normal, new AbortController().signal));
    assert.equal(cancelled, true, 'Oversized streams are stopped without unbounded buffering');
}
console.log('PASS: shared snapshots, canonical variants, UUID isolation, initial/event/reload races, bounded queue/body/fanout, rolling freshness, fallback backoff and idle cleanup');
