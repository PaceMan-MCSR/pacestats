import assert from 'node:assert/strict';
import {frameValue} from '../app/obs/frameValue';

const frames = new Map<number, FrameRequestCallback>();
let nextId = 0;
const values: string[] = [];
const update = frameValue((value: string) => values.push(value), callback => {
    frames.set(++nextId, callback); return nextId;
}, id => {frames.delete(id);});
for (let i = 0; i < 100; i++) update.schedule(`#${i}`);
assert.equal(frames.size, 1);
assert.deepEqual([...values], []);
frames.values().next().value!(0);
assert.deepEqual([...values], ['#99']);
assert.equal(frames.size, 0);
update.schedule('#last');
update.flush();
assert.deepEqual([...values], ['#99', '#last']);
assert.equal(frames.size, 0);
update.schedule('#obsolete');
update.immediately('#typed');
assert.equal(values.at(-1), '#typed');
assert.equal(frames.size, 0);
update.schedule('#unmounted');
update.cancel();
assert.equal(frames.size, 0);
update.flush();
assert.equal(values.at(-1), '#typed');
console.log('100 color drag updates commit once/frame; pointer-up flush, immediate text edits and unmount cancellation preserve final value');
