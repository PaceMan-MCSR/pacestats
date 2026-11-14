/** Spread connection heartbeats across one cycle, yielding during large buckets. */
export class HeartbeatWheel {
    constructor({intervalMs = 30_000, slices = 30, batchSize = 256,
        every = setInterval, cancelEvery = clearInterval,
        defer = setImmediate, cancelDefer = clearImmediate} = {}) {
        this.buckets = Array.from({length:slices},() => new Set());
        this.intervalMs = intervalMs / slices;
        this.batchSize = batchSize;
        this.every = every;this.cancelEvery = cancelEvery;
        this.defer = defer;this.cancelDefer = cancelDefer;
        this.cursor = 0;this.nextSlot = 0;this.count = 0;
        this.timer = null;this.continuation = null;this.pending = [];
    }

    add(client) {
        if(client.heartbeatBucket !== undefined) return;
        const slot = (this.cursor + 1 + this.nextSlot++) % this.buckets.length;
        client.heartbeatBucket = slot;
        this.buckets[slot].add(client);
        this.count++;
        if(this.timer === null) {
            this.timer = this.every(() => this.tick(),this.intervalMs);
            this.timer.unref?.();
        }
    }

    remove(client) {
        const slot = client.heartbeatBucket;
        if(slot === undefined) return;
        client.heartbeatBucket = undefined;
        if(this.buckets[slot].delete(client)) this.count--;
        if(this.count === 0) this.clear();
    }

    tick() {
        this.cursor = (this.cursor + 1) % this.buckets.length;
        const bucket = this.buckets[this.cursor];
        if(bucket.size) this.pending.push(bucket.values());
        if(this.continuation === null) this.drain();
    }

    drain() {
        this.continuation = null;
        let budget = this.batchSize;
        while(this.pending.length && budget > 0) {
            const next = this.pending[0].next();
            if(next.done) {this.pending.shift();continue;}
            budget--;
            const client = next.value;
            if(client.heartbeatBucket === undefined) continue;
            if(client.readyState !== 1) {this.remove(client);continue;}
            if(client.isAlive === false) {
                this.remove(client);client.terminate();continue;
            }
            client.isAlive = false;
            client.ping();
        }
        if(this.pending.length) {
            this.continuation = this.defer(() => this.drain());
            this.continuation.unref?.();
        }
    }

    clear() {
        if(this.timer !== null) this.cancelEvery(this.timer);
        if(this.continuation !== null) this.cancelDefer(this.continuation);
        this.timer = null;this.continuation = null;this.pending = [];
        for(const bucket of this.buckets) {
            for(const client of bucket) client.heartbeatBucket = undefined;
            bucket.clear();
        }
        this.count = 0;
    }
}
