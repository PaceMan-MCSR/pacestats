import assert from "node:assert/strict";
import {mock} from "node:test";
import {schedulePlayerPrefetch} from "../app/components/playerPrefetch";

mock.timers.enable({apis: ["Date", "setTimeout"], now: 1_000_000});
try {
    const calls: string[] = [];
    const prepare = (path: string) => schedulePlayerPrefetch(path, () => calls.push(path));
    const first = prepare("shared"), second = prepare("shared");
    first(); first(); mock.timers.tick(0);
    assert.deepEqual(calls, ["shared"], "Two search boxes share a prefetch; one release does not cancel the other");
    second();

    const cancelled = prepare("cancelled");
    prepare("next"); cancelled(); mock.timers.tick(49);
    assert.equal(calls.length, 1, "Requests remain spaced by fifty milliseconds");
    mock.timers.tick(1);
    assert.deepEqual(calls, ["shared", "next"], "Cancellation removes pending work without changing FIFO order");

    for (let index = 0; index < 20_000; index++) prepare(`cancel-${index}`)();
    mock.timers.tick(60_000);
    assert.equal(calls.length, 2, "Rapidly replaced queries retain no cancelled callbacks or idle work");

    for (let index = 0; index < 1_000; index++) prepare(`bounded-${index}`);
    for (let index = 0; index < 65; index++) mock.timers.tick(50);
    assert.equal(calls.length, 66, "At most 64 tentative paths remain queued during a burst");
    prepare("bounded-999"); mock.timers.tick(50);
    assert.equal(calls.at(-1), "bounded-999", "Omitted speculative work remains eligible on the next intent");

    schedulePlayerPrefetch("failure", () => { throw new Error("Speculative fixture failure"); });
    mock.timers.tick(50); prepare("failure"); mock.timers.tick(50);
    assert.equal(calls.at(-1), "failure", "A synchronous router failure is not cached as a successful prefetch");

    const before = calls.length;
    prepare("failure"); mock.timers.tick(50);
    assert.equal(calls.length, before, "Successful preparation is reused for thirty seconds");
    mock.timers.tick(30_000); prepare("failure"); mock.timers.tick(0);
    assert.equal(calls.length, before + 1, "Expired preparation can refresh");
    console.log("PASS: prefetch deduplicates, preserves 50ms FIFO pacing, cancels 20k obsolete intents, caps pending work at 64 and permits failure/overflow retries");
} finally {
    mock.timers.reset();
}
