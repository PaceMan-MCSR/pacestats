import assert from 'node:assert/strict';
import {HeartbeatWheel} from '../ws/heartbeat-wheel.mjs';
let tick = 0, nextId = 0, largestBurst = 0, currentBurst = 0, intervalsCreated = 0;
const intervals = new Map(), continuations = new Map();
const wheel = new HeartbeatWheel({
    every:callback => {const id = ++nextId;intervals.set(id,callback);intervalsCreated++;return id;},
    cancelEvery:id => intervals.delete(id),
    defer:callback => {const id = ++nextId;continuations.set(id,callback);return id;},
    cancelDefer:id => continuations.delete(id),
});
const clients = Array.from({length:10_000},(_,index) => ({
    readyState:1,isAlive:true,pings:[],terminated:false,
    ping(){this.pings.push(tick);currentBurst++;if(index !== 0) this.isAlive = true;},
    terminate(){this.terminated = true;},
}));
const step = () => {
    tick++;
    for(const callback of intervals.values()) {
        currentBurst = 0;callback();largestBurst = Math.max(largestBurst,currentBurst);
    }
    while(continuations.size) {
        const [id,callback] = continuations.entries().next().value;
        continuations.delete(id);currentBurst = 0;callback();largestBurst = Math.max(largestBurst,currentBurst);
    }
};
assert.equal(intervals.size,0,'No idle timer without subscribers');
clients.forEach(client => wheel.add(client));
assert.equal(intervals.size,1);assert.equal(intervalsCreated,1);
for(let i=0;i<30;i++) step();
assert.ok(clients.every(client => client.pings.length === 1));
assert.ok(largestBurst <= 256,'Every callback has bounded ping work, even at full capacity');
assert.equal(clients[0].terminated,false,'A missed pong gets a complete cycle of grace');
for(let i=0;i<30;i++) step();
assert.equal(clients[0].terminated,true);
assert.ok(clients.slice(1).every(client => client.pings.length === 2 && client.pings[1]-client.pings[0] === 30));
clients.forEach(client => wheel.remove(client));
assert.equal(wheel.count,0);assert.equal(intervals.size,0);assert.equal(continuations.size,0);

// Reconnect/close churn releases bucket references and restores a single timer.
for(let i=0;i<1000;i++) {
    const client = {readyState:1,isAlive:true,ping(){this.isAlive = true;},terminate(){}};
    wheel.add(client);wheel.remove(client);wheel.remove(client);
}
assert.equal(wheel.count,0);assert.ok(wheel.buckets.every(bucket => bucket.size === 0));
clients[1].isAlive = true;wheel.add(clients[1]);wheel.clear();
assert.equal(intervals.size,0);assert.equal(clients[1].heartbeatBucket,undefined);
console.log(JSON.stringify({checks:'10k clients get one ping/cycle; missing pong terminates next cycle; bounded callbacks; idle/close/shutdown cleanup',
    legacyPingsPerCallback:10_000,maxPingsPerCallback:largestBurst,timersWhileIdle:intervals.size}));
