import assert from "node:assert/strict";
import {overlaySocketUrl, sessionSocketUrl} from "../app/obs/sessionSubscription";

for (const uuid of [undefined, null, "", "undefined", "null", 42]) {
    assert.equal(sessionSocketUrl("ws://localhost:8080", uuid), null, "Unresolved/error overlays must not consume WebSocket subscriptions");
}
for (const endpoint of [undefined, "", "not-a-url", "https://localhost:8080"]) {
    assert.equal(sessionSocketUrl(endpoint, "valid-player"), null);
}
assert.equal(sessionSocketUrl("ws://localhost:8080/", "valid-player"), "ws://localhost:8080/pull/valid-player");
assert.equal(sessionSocketUrl("wss://local.test/ws2", "player/id"), "wss://local.test/ws2/pull/player%2Fid");
console.log("PASS: unresolved overlays create no socket; resolved subscriptions preserve endpoint paths and encode IDs");

assert.equal(overlaySocketUrl(undefined, '/stats/api/getSessionStats/?name=Player'), null);
assert.equal(overlaySocketUrl('https://local.test', '/stats/api/getSessionStats/?name=Player'), null);
assert.equal(overlaySocketUrl('wss://local.test/ws2', '/stats/api/getWorld/?name=Player'), null);
assert.equal(overlaySocketUrl('wss://local.test/ws2/', '/stats/api/getSessionStats/?name=A%26B&hours=24'),
    'wss://local.test/ws2/overlay?kind=session&hours=24&name=A%26B');
assert.equal(overlaySocketUrl('ws://localhost:8080', '/stats/api/getCombinedNethers/?names=A%2CB&maxTime=150000'),
    'ws://localhost:8080/overlay?kind=combinedNethers&maxTime=150000&names=A%2CB');
assert.equal(overlaySocketUrl('ws://localhost:8080', '/stats/api/getSessionNethers/?nph=false&name=Player&hours=24'),
    overlaySocketUrl('ws://localhost:8080', '/stats/api/getSessionNethers/?hours=24&name=Player&nph=false'));
console.log('PASS: snapshot URLs cover four overlay APIs, stable ordering, name encoding and reverse-proxy prefixes');
