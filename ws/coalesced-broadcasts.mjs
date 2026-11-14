/** Preserve each UUID's first-event deadline with one timer for the whole queue. */
export class CoalescedBroadcasts {
    constructor(broadcast, delayMs, {now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout} = {}) {
        this.broadcast = broadcast;
        this.delayMs = Math.max(0, delayMs);
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
        this.pending = new Map();
        this.timer = null;
    }

    add(uuid, message = 'refresh') {
        const existing = this.pending.get(uuid);
        if (existing) {
            if (message === 'reloadPage') existing.message = message;
            return;
        }
        this.pending.set(uuid, {message, due: this.now() + this.delayMs});
        if (this.timer === null) this.arm();
    }

    arm() {
        const first = this.pending.values().next().value;
        if (!first) return;
        // Map insertion order is deadline order. New UUIDs never postpone an
        // older event, and callbacks can enqueue new events during a flush.
        this.timer = this.schedule(() => {
            this.timer = null;
            const due = this.now();
            for (const [uuid, pending] of this.pending) {
                if (pending.due > due) break;
                this.pending.delete(uuid);
                this.broadcast(uuid, pending.message);
            }
            if (this.timer === null) this.arm();
        }, Math.max(0, Math.ceil(first.due - this.now())));
        this.timer.unref?.();
    }

    clear() {
        if (this.timer !== null) this.cancel(this.timer);
        this.timer = null;
        this.pending.clear();
    }
}
