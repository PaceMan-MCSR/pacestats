import assert from 'node:assert/strict';
import Fuse from 'fuse.js';
import {defaultFuseOptions, sharedSearchIndex} from '../app/components/search/searchIndex';

const items = Array.from({length:10000}, (_, id) => ({id, name:`Player${id}`}));
const options = {...defaultFuseOptions, threshold: 0.3};
const first = sharedSearchIndex(Fuse, items, options);
for (let i = 0; i < 20; i++) assert.equal(sharedSearchIndex(Fuse, items, options), first);
assert.notEqual(sharedSearchIndex(Fuse, [...items], options), first);
assert.notEqual(sharedSearchIndex(Fuse, items, {...options}), first);
const independent = new Fuse(items, options);
for (const query of ['Player1', 'Plar155', 'Player9999', 'nothing']) {
    assert.deepEqual(first.search(query, {limit:10}), independent.search(query, {limit:10}));
}
console.log('Twenty search boxes share one 10k-player index; new collections/options stay isolated; fuzzy ordering and scores match');
