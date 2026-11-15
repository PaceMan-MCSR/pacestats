/** Docker fixture: cold lists, cancellation, seeds and outages use bounded work. */
import assert from "node:assert/strict";
import {mock} from "node:test";
import {PlayerInfoRequests} from "../app/components/playerInfoRequests";
import type {PlayerInfo} from "../app/components/playerInfoCache";

const info = (name: string): PlayerInfo => ({id: name, displayName: name, color: null, bgColor: null});
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };
const advance = async (ms: number) => { mock.timers.tick(ms); await settle(); };

function fixture(ignoreAbort = false) {
    const needed = new Set<string>();
    const values = new Map<string, PlayerInfo | null>();
    const reads: Array<{names: string[]; signal: AbortSignal; done: boolean;
        resolve: (result?: Record<string, PlayerInfo | null>) => void; reject: () => void}> = [];
    const requests = new PlayerInfoRequests({
        needed: name => needed.has(name), lookup: name => values.get(name),
        store: (name, value) => values.set(name, value),
        fetch: (names, signal) => new Promise((resolve, reject) => {
            const read = {names, signal, done: false,
                resolve: (result: Record<string, PlayerInfo | null> = Object.fromEntries(names.map(name => [name, info(name)]))) => {
                    read.done = true; resolve(result);
                },
                reject: () => { read.done = true; reject(new Error("Fixture failure")); }};
            reads.push(read);
            if (!ignoreAbort) signal.addEventListener("abort", read.reject, {once: true});
        }),
    });
    return {needed, values, reads, requests,
        mount(name: string) { needed.add(name); requests.request(name); },
        release(name: string) { needed.delete(name); requests.cancel(name); },
    };
}

async function main() {
    mock.timers.enable({apis: ["Date", "setTimeout"], now: 1_000_000});
    try {
        const cold = fixture();
        for (let index = 0; index < 130; index++) cold.mount(`player-${index}`);
        await advance(19);
        assert.equal(cold.reads.length, 0, "Rows rendered together retain the 20ms coalescing window");
        await advance(1);
        assert.equal(cold.reads.length, 2, "A cold list starts only two concurrent requests");
        assert.ok(cold.reads.every(read => read.names.length === 20));
        for (let round = 0; round < 5 && cold.values.size < 130; round++) {
            assert.ok(cold.reads.filter(read => !read.done).length <= 2);
            cold.reads.filter(read => !read.done).forEach(read => read.resolve());
            await settle(); await advance(0);
        }
        assert.equal(cold.values.size, 130, "Every visible player eventually resolves with bounded concurrency");
        assert.equal(cold.reads.length, 7, "Twenty-name batching does not introduce duplicate reads");
        cold.requests.request("player-0"); await advance(20);
        assert.equal(cold.reads.length, 7, "Warm identities need no HTTP work");

        const absent = fixture();
        absent.mount("gone"); absent.release("gone"); await advance(20);
        assert.equal(absent.reads.length, 0, "Rows that depart before flushing never fetch");

        const seeded = fixture(true);
        seeded.mount("seeded"); seeded.mount("neighbor"); await advance(20);
        const newer = {...info("seeded"), color: "abcdef"};
        seeded.requests.cancel("seeded"); seeded.values.set("seeded", newer);
        seeded.reads[0].resolve(); await settle();
        assert.deepEqual(seeded.values.get("seeded"), newer, "An older batch cannot overwrite a page seed");
        assert.equal(seeded.values.get("neighbor")?.id, "neighbor", "Other rows still receive their shared response");

        const orphaned = fixture();
        orphaned.mount("a"); orphaned.mount("b"); await advance(20);
        orphaned.release("a");
        assert.equal(orphaned.reads[0].signal.aborted, false, "One departing row does not abort a shared batch");
        orphaned.release("b");
        assert.equal(orphaned.reads[0].signal.aborted, true, "The last subscriber aborts orphaned network/body work");
        await settle(); await advance(60_000);
        assert.equal(orphaned.reads.length, 1, "Unmounting does not schedule a retry");

        const retry = fixture();
        retry.mount("retry"); await advance(20);
        retry.reads[0].reject(); await settle();
        await advance(999); assert.equal(retry.reads.length, 1);
        await advance(1); assert.equal(retry.reads.length, 2, "A visible row recovers once after a transient failure");
        retry.reads[1].reject(); await settle(); await advance(60_000);
        assert.equal(retry.reads.length, 2, "An outage cannot create an unbounded retry loop");

        const slow = fixture();
        for (let index = 0; index < 41; index++) slow.mount(`slow-${index}`);
        await advance(20); await advance(8_000);
        assert.ok(slow.reads.slice(0, 2).every(read => read.signal.aborted), "Hung requests abort after eight seconds");
        await advance(0);
        assert.equal(slow.reads[2].names.length, 1, "Timeout releases a slot so queued visible players can progress");
        slow.reads[2].resolve(); await settle();
        await advance(1_000);
        assert.equal(slow.reads.length, 5, "Timed-out batches receive only the single allowed retry");
        await advance(8_000); await advance(60_000);
        assert.equal(slow.reads.length, 5);

        const unknown = fixture();
        unknown.mount("unknown"); unknown.mount("unknown"); await advance(20);
        assert.equal(unknown.reads.length, 1);
        unknown.reads[0].resolve({unknown: null}); await settle();
        unknown.requests.request("unknown"); await advance(60_000);
        assert.equal(unknown.reads.length, 1, "A successful negative lookup is cached rather than retried");
        console.log("PASS: 130 cold identities use seven batches with at most two in flight; seeds win; departing rows cancel; timeouts release slots; retries stop after one attempt");
    } finally {
        mock.timers.reset();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
