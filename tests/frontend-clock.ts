/** Run with `node --import tsx tests/frontend-clock.ts` in the local Docker environment. */
import assert from 'node:assert/strict';
import {subscribeRelativeClock} from '../app/components/profile/relativeTimeClock';

const timers = new Map<number, () => void>();
const listeners = new Map<string, () => void>();
let nextTimer = 0;
const originalDocument = globalThis.document;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const fakeDocument = {
    visibilityState: 'visible',
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    removeEventListener: (event: string, callback: () => void) => {
        if (listeners.get(event) === callback) listeners.delete(event);
    },
};

try {
    globalThis.document = fakeDocument as unknown as Document;
    globalThis.setInterval = ((callback: () => void) => {
        timers.set(++nextTimer, callback);
        return nextTimer;
    }) as unknown as typeof globalThis.setInterval;
    globalThis.clearInterval = ((id: number) => timers.delete(id)) as unknown as typeof globalThis.clearInterval;
    let ticks = 0;
    const unsubscribe = Array.from({length: 200}, () => subscribeRelativeClock(() => ticks++, 1_000));
    assert.equal(timers.size, 1);
    timers.values().next().value!();
    assert.equal(ticks, 200);
    const secondGroup = subscribeRelativeClock(() => ticks++, 30_000);
    assert.equal(timers.size, 2);
    fakeDocument.visibilityState = 'hidden';
    listeners.get('visibilitychange')!();
    assert.equal(timers.size, 0);
    fakeDocument.visibilityState = 'visible';
    listeners.get('visibilitychange')!();
    assert.equal(ticks, 401);
    assert.equal(timers.size, 2);
    unsubscribe.forEach(off => off());
    secondGroup();
    assert.equal(timers.size, 0);
    assert.equal(listeners.size, 0);
    console.log('Relative clocks: 200 subscribers share one interval; hidden tabs pause; return refreshes; unmount releases resources');
} finally {
    globalThis.document = originalDocument;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
}
