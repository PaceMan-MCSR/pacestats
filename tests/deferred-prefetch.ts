import assert from "node:assert/strict";
import {mock} from "node:test";
import {scheduleDeferredPrefetch} from "../app/components/useDeferredPrefetch";

mock.timers.enable({apis: ["setTimeout"]});
try {
    const prepared: string[] = [];
    scheduleDeferredPrefetch(() => prepared.push("settled page"));
    mock.timers.tick(749);
    assert.deepEqual([...prepared], [], "Initial navigation gets a grace period without automatic prefetch");
    mock.timers.tick(1);
    assert.deepEqual([...prepared], ["settled page"]);

    const unmount = scheduleDeferredPrefetch(() => prepared.push("departed page"));
    mock.timers.tick(300);
    unmount();
    mock.timers.tick(750);
    assert.deepEqual([...prepared], ["settled page"], "Leaving before the deadline cancels speculative work");

    const changeName = scheduleDeferredPrefetch(() => prepared.push("old player"));
    mock.timers.tick(400);
    changeName();
    scheduleDeferredPrefetch(() => prepared.push("new player"));
    mock.timers.tick(350);
    assert.deepEqual([...prepared], ["settled page"], "A new destination does not inherit an old timer");
    mock.timers.tick(400);
    assert.deepEqual([...prepared], ["settled page", "new player"]);
    console.log("PASS: automatic history preparation waits 750ms; departing pages and changed destinations cancel obsolete timers");
} finally {
    mock.timers.reset();
}
