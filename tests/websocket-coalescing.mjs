/** Docker: deterministic deadlines, reentrancy and retained-timer benchmark. */
import assert from 'node:assert/strict';
import {CoalescedBroadcasts} from '../ws/coalesced-broadcasts.mjs';

let now = 0, nextId = 0;
const timers = new Map(), delivered = [];
const queue = new CoalescedBroadcasts((uuid,message) => {
    delivered.push([now,uuid,message]);
    if(uuid === 'reentrant') queue.add('inside');
},100,{
    now:() => now,
    schedule:(run,delay) => {const id = ++nextId;timers.set(id,{run,due:now+delay});return id;},
    cancel:id => timers.delete(id),
    defer:run => {const id = ++nextId;timers.set(id,{run,due:now});return id;},
    cancelDefer:id => timers.delete(id),
});
const advance = to => {
    while(timers.size) {
        const next = [...timers].sort((a,b) => a[1].due-b[1].due)[0];
        if(next[1].due > to) break;
        timers.delete(next[0]);now = next[1].due;next[1].run();
    }
    now = to;
};
queue.add('a');queue.add('a');queue.add('a','reloadPage');queue.add('a');
advance(25);queue.add('b');
assert.equal(timers.size,1);
advance(99);assert.equal(delivered.length,0);
advance(100);assert.deepEqual(delivered,[[100,'a','reloadPage']]);
advance(125);assert.deepEqual(delivered.at(-1),[125,'b','refresh']);assert.equal(timers.size,0);
queue.add('reentrant');advance(225);assert.equal(timers.size,1);advance(325);
assert.deepEqual(delivered.slice(-2),[[225,'reentrant','refresh'],[325,'inside','refresh']]);
queue.add('clear');queue.clear();assert.equal(timers.size,0);assert.equal(queue.pending.size,0);
advance(500);assert.equal(delivered.length,4);
for(let i=0;i<10_000;i++) queue.add(`uuid-${i}`);
assert.equal(timers.size,1);advance(600);assert.equal(delivered.length,10_004);assert.equal(timers.size,0);
console.log('PASS: one shared timer preserves deadlines, duplicate coalescing, reload priority, reentrant delivery and shutdown cleanup');

let wake, continuation, weight = 0, maxWeight = 0;
const weighted = new CoalescedBroadcasts(() => {weight += 100;},0,{
    now:()=>0,weightFor:()=>100,
    schedule:callback => {wake = callback;return 1;},cancel:()=>{},
    defer:callback => {continuation = callback;return 2;},cancelDefer:()=>{continuation = undefined;},
});
for(let i=0;i<100;i++) weighted.add(`group-${i}`);
wake();maxWeight = weight;
while(continuation) {const callback = continuation;continuation = undefined;weight = 0;callback();maxWeight = Math.max(maxWeight,weight);}
assert.equal(weighted.pending.size,0);
assert.equal(maxWeight,200,'Ten thousand subscribers are dispatched with bounded weighted callbacks');
for(let i=0;i<100;i++) weighted.add(`clear-${i}`);
wake();assert.ok(continuation);weighted.clear();assert.equal(continuation,undefined);
console.log('PASS: weighted dispatch bounds default subscription fanout, yields between batches and cancels continuations');

if(process.env.PERF_BENCHMARK === '1') {
    const kind = process.env.PERF_VARIANT ?? 'current';
    global.gc?.();const before = process.memoryUsage(), cpu = process.cpuUsage();
    const count = 20_000, handles = [], pending = new Map();
    const current = new CoalescedBroadcasts(() => {},60_000);
    for(let i=0;i<count;i++) {
        if(kind === 'current') current.add(`uuid-${i}`);
        else {
            const entry = {message:'refresh',timer:null};
            entry.timer = setTimeout(() => pending.delete(`uuid-${i}`),60_000);entry.timer.unref();
            pending.set(`uuid-${i}`,entry);handles.push(entry.timer);
        }
    }
    global.gc?.();const after = process.memoryUsage(), used = process.cpuUsage(cpu);
    console.log(JSON.stringify({kind,uuids:count,timers:kind==='current'?1:handles.length,cpuMs:(used.user+used.system)/1000,
        retainedHeapMiB:(after.heapUsed-before.heapUsed)/1048576,rssMiB:after.rss/1048576}));
    current.clear();handles.forEach(clearTimeout);
}
