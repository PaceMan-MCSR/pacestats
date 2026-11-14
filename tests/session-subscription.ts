import assert from "node:assert/strict";
import {sessionSocketUrl} from "../app/obs/sessionSubscription";

for (const uuid of [undefined, null, "", "undefined", "null", 42]) {
    assert.equal(sessionSocketUrl("ws://localhost:8080", uuid), null, "Unresolved/error overlays must not consume WebSocket subscriptions");
}
for (const endpoint of [undefined, "", "not-a-url", "https://localhost:8080"]) {
    assert.equal(sessionSocketUrl(endpoint, "valid-player"), null);
}
assert.equal(sessionSocketUrl("ws://localhost:8080/", "valid-player"), "ws://localhost:8080/pull/valid-player");
assert.equal(sessionSocketUrl("wss://local.test/ws2", "player/id"), "wss://local.test/ws2/pull/player%2Fid");
console.log("PASS: unresolved overlays create no socket; resolved subscriptions preserve endpoint paths and encode IDs");
