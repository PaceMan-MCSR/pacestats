import type Fuse from 'fuse.js';

export const defaultFuseOptions = {
    shouldSort: true, threshold: 0.6, location: 0, distance: 100,
    minMatchCharLength: 1, keys: ['name'],
};

// Collections and options are immutable inputs, as for useMemo. Weak ownership
// lets obsolete remote-result collections disappear with their search boxes.
const indexes = new WeakMap<object, WeakMap<object, {fuseClass: typeof Fuse; index: Fuse<any>}>>();

export function sharedSearchIndex<T>(constructor: typeof Fuse, items: T[], options: Fuse.IFuseOptions<T>): Fuse<T> {
    let byOptions = indexes.get(items);
    if (!byOptions) indexes.set(items, byOptions = new WeakMap());
    const cached = byOptions.get(options);
    if (cached?.fuseClass === constructor) return cached.index;
    const index = new constructor(items, {...defaultFuseOptions, ...options});
    byOptions.set(options, {fuseClass: constructor, index});
    return index;
}
