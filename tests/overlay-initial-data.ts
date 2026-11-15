/** Docker only: bounded SSR seed reuse must never cache failures or stale live reads. */
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {getCached} from "../app/data";
import {initialOverlayData} from "../app/obs/initialData.server";
import {OverlaySnapshotError, readOverlaySnapshot} from "../app/obs/snapshot.server";

assert.ok(existsSync("/.dockerenv"), "Use local Docker");
type Seed = {nether: {count: number}};
type SeedEnvelope = {data: Seed; at: number};
type TestRuntime = typeof globalThis & {
    __paceStatsDbPool: any;
    __paceStatsInitialOverlayReads: Map<string, Promise<any>>;
    __paceStatsInitialOverlayData: Map<string, {data: any; expiresAt: number}>;
    __paceStatsActiveOverlaySnapshots?: number;
};
async function main() {
    const runtime = globalThis as TestRuntime, pool = runtime.__paceStatsDbPool;
    const acquire = pool.getConnection.bind(pool), originalNow = Date.now;
    const instant = originalNow();
    let clock = instant, queries = 0, version = 1, fail = false;
    let wait: Promise<void> | undefined, release = () => {};
    Date.now = () => clock;
    const pending = runtime.__paceStatsInitialOverlayReads, recent = runtime.__paceStatsInitialOverlayData;
    const settings = (hours = 24) => ({hours, hoursBetween: 6});
    const seed = (hours = 24) => initialOverlayData("session", "InitialFixture", settings(hours), false) as Promise<SeedEnvelope | undefined>;
    const hold = () => {wait = new Promise<void>(resolve => {release = resolve;});};
    const untilQueries = async (count: number) => {
        for (let index = 0; queries < count && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(queries, count);
    };
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}) => {
            connection.execute = execute;
            queries++;
            assert.match(options.sql, /WHERE uuid=\?/);
            assert.match(options.sql, /LIMIT \?/);
            if (wait) await wait;
            if (fail) throw new Error("Injected initial overlay failure");
            return [Array.from({length: version}, (_, index) => ({
                id: 500_000 + index, nether: 100_000, bastion: null, fortress: null,
                first_portal: null, stronghold: null, end: null, finish: null, obtainRod: null,
                time: Math.floor(instant / 1000) - index * 60,
            })), []];
        };
        return connection;
    };
    try {
        assert.equal(pending.size, 0);assert.equal(recent.size, 0);
        assert.equal(await initialOverlayData("session", "UnresolvedDemo", settings(), true), undefined);
        assert.equal(queries, 0, "Demo skips identity and SQL work");
        await getCached(async () => ({uuid: "initial-fixture-uuid", nick: "InitialFixture"}), "getAllNamesByNick", "InitialFixture");

        hold();
        const first = seed(), second = seed();
        await untilQueries(1);
        assert.equal(pending.size, 1, "Simultaneous identical SSR pages share one read");
        clock = instant + 25;
        release();wait = undefined;
        assert.deepEqual(await first, await second);
        assert.equal((await first)?.data.nether.count, 1);
        assert.equal((await first)?.at, instant + 25, "The seed timestamps read completion, so an overlapping older WS read cannot replace it");
        assert.equal(pending.size, 0);assert.equal(recent.size, 1);

        version = 2;
        assert.equal((await seed())?.data.nether.count, 1);
        assert.equal(queries, 1, "A burst reuses the successful two-second HTML seed");
        const live = await readOverlaySnapshot(new URLSearchParams("kind=session&name=InitialFixture&hours=24&hoursBetween=6"));
        assert.equal(live.data.nether.count, 2, "Live WS projection bypasses the SSR seed cache");
        assert.equal(queries, 2);
        assert.equal((await seed())?.data.nether.count, 1);
        clock = instant + 25 + 1999;
        assert.equal((await seed())?.data.nether.count, 1);
        clock++;
        assert.equal((await seed())?.data.nether.count, 2, "The seed expires exactly at two seconds");
        assert.equal(queries, 3);

        recent.clear();clock = instant;
        const beforeLru = queries;
        for (let hours = 1; hours <= 64; hours++) assert.equal((await seed(hours))?.data.nether.count, 2);
        assert.equal(recent.size, 64);assert.equal(queries - beforeLru, 64);
        await seed(1);assert.equal(queries - beforeLru, 64);
        await seed(65);assert.equal(queries - beforeLru, 65);
        await seed(1);assert.equal(queries - beforeLru, 65, "A touched seed remains in the LRU");
        await seed(2);assert.equal(queries - beforeLru, 66, "The oldest untouched seed was evicted");
        assert.equal(recent.size, 64, "Distinct-page bursts cannot grow retained entries beyond 64");

        recent.clear();fail = true;
        const beforeFailure = queries;
        assert.equal(await seed(), undefined);
        assert.equal(queries - beforeFailure, 1);assert.equal(pending.size, 0);assert.equal(recent.size, 0);
        fail = false;
        assert.equal((await seed())?.data.nether.count, 2);
        assert.equal(queries - beforeFailure, 2, "A failed seed never prevents immediate retry");
        recent.clear();
        hold();
        const beforePressure = queries;
        const reads = [101,102,103,104].map(hours => seed(hours));
        await untilQueries(beforePressure + 4);
        assert.equal(pending.size, 4);assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 4);
        assert.equal(await seed(105), undefined, "Extra SSR work falls back to socket delivery under pressure");
        assert.equal(await initialOverlayData("session", "UnresolvedDemo", settings(), true), undefined);
        const duplicate = seed(101);
        await assert.rejects(readOverlaySnapshot(new URLSearchParams("kind=session&name=InitialFixture")),
            error => error instanceof OverlaySnapshotError && error.status === 429);
        assert.equal(queries, beforePressure + 4, "Overload and duplicate joins do not acquire another SQL connection");
        release();wait = undefined;
        assert.ok((await Promise.all(reads)).every(value => value?.data.nether.count === 2));
        assert.equal((await duplicate)?.data.nether.count, 2);
        assert.equal(pending.size, 0);assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 0);
        assert.equal((await seed(105))?.data.nether.count, 2, "A skipped overload seed retries after capacity is released");

        recent.clear();
        const beforeInvalid = queries;
        assert.equal(await seed(0), undefined);
        assert.equal(await seed(0), undefined);
        assert.equal(queries, beforeInvalid);assert.equal(recent.size, 0);
        await getCached(async () => ({uuid: "x".repeat(33_000), nick: "OversizedFixture"}), "getAllNamesByNick", "OversizedFixture");
        assert.equal(await initialOverlayData("session", "OversizedFixture", settings(), false), undefined);
        assert.equal(recent.size, 0, "An oversized provider value is not retained as HTML seed data");

        // Empty resolved UUIDs need no SQL and let the real combined formatter
        // prove raw and route-escaped comma lists resolve through the same key.
        await getCached(async () => ({uuids: [], unknown: []}), "resolveCombinedPlayerUuids", ["One", "Two"]);
        const beforeNames = queries;
        const raw = await initialOverlayData("combinedStats", "One,Two", settings(), false);
        const escaped = await initialOverlayData("combinedStats", "One%2CTwo", settings(), false);
        assert.deepEqual(escaped, raw);
        assert.deepEqual(raw.data.nether, {count: 0, avg: "0:00"});
        assert.equal(queries, beforeNames);assert.equal(recent.size, 1);
        assert.equal(pending.size, 0);assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 0);
    } finally {
        release();pool.getConnection = acquire;Date.now = originalNow;
    }
    console.log("OBS initial HTML data: demo skip, shared reads, exact two-second TTL, 64-entry LRU, bounded overload, uncached failures/oversize, live-cache bypass and encoded/raw combined-name parity pass");
}
main().then(() => process.exit(0), error => {console.error(error);process.exit(1);});
