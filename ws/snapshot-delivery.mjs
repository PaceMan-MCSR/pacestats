/** Full snapshots can replace queued snapshots; reload retains priority. */
export class SnapshotDelivery {
    constructor(send, {batchSize = 256, defer = setImmediate, cancel = clearImmediate} = {}) {
        this.send = send;
        this.batchSize = batchSize;
        this.defer = defer;
        this.cancel = cancel;
        this.pending = new Map();
        this.continuation = null;
    }

    add(client, message) {
        if (this.pending.get(client) === 'reloadPage') return;
        this.pending.set(client, message);
        if (this.continuation === null) {
            this.continuation = this.defer(() => this.flush());
            this.continuation.unref?.();
        }
    }

    remove(client) { this.pending.delete(client); }

    flush() {
        this.continuation = null;
        let remaining = this.batchSize;
        for (const [client, message] of this.pending) {
            this.pending.delete(client);
            this.send(client, message);
            if (--remaining === 0) break;
        }
        if (this.pending.size) {
            this.continuation = this.defer(() => this.flush());
            this.continuation.unref?.();
        }
    }

    clear() {
        if (this.continuation !== null) this.cancel(this.continuation);
        this.continuation = null;
        this.pending.clear();
    }
}
