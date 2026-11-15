/** One bounded, shared snapshot job per active overlay parameter set. */
export class SnapshotBroker {
    constructor({fetchSnapshot, send, maxGroups = 512, maxClientsPerGroup = 100,
        maxBytes = 32 * 1024, concurrency = 2, refreshMs = 30_000,
        retryMs = 5_000, now = () => Date.now(), schedule = setTimeout,
        cancel = clearTimeout, onError = () => {}}) {
        this.fetchSnapshot = fetchSnapshot;
        this.send = send;
        this.maxGroups = maxGroups;
        this.maxClientsPerGroup = maxClientsPerGroup;
        this.maxBytes = maxBytes;
        this.concurrency = concurrency;
        this.refreshMs = refreshMs;
        this.retryMs = retryMs;
        this.now = now;
        this.schedule = schedule;
        this.cancel = cancel;
        this.onError = onError;
        this.groups = new Map();
        this.byClient = new Map();
        this.byUuid = new Map();
        this.pending = new Set();
        this.active = 0;
        this.notifications = 0;
        this.timer = null;
        this.closed = false;
    }

    add(client, subscription) {
        if (this.closed || this.byClient.has(client)) return false;
        let group = this.groups.get(subscription.key);
        if (!group) {
            if (this.groups.size >= this.maxGroups) return false;
            group = {subscription, clients: new Set(), uuids: [], running: false,
                dirty: false, revision: 0, sequence: 0, controller: null,
                message: null, failed: false, nextAt: null};
            this.groups.set(subscription.key, group);
        }
        if (group.clients.size >= this.maxClientsPerGroup) return false;
        group.clients.add(client);
        this.byClient.set(client, group);
        if (group.message !== null) this.send(client, group.message);
        if (group.failed) this.send(client, this.errorMessage);
        // In-flight joins share that result. A healthy, already loaded group
        // supplies its latest message without another API/SQL request.
        if (!group.running && !this.pending.has(group)
            && (group.nextAt === null || group.nextAt <= this.now())) this.request(group);
        return true;
    }

    get errorMessage() {
        return '{"type":"snapshot-error","version":1}';
    }

    remove(client) {
        const group = this.byClient.get(client);
        if (!group) return;
        this.byClient.delete(client);
        group.clients.delete(client);
        if (group.clients.size) return;
        this.groups.delete(group.subscription.key);
        this.pending.delete(group);
        this.unindex(group);
        group.revision++;
        group.controller?.abort();
        group.message = null;
        this.arm();
    }

    unindex(group) {
        for (const uuid of group.uuids) {
            const groups = this.byUuid.get(uuid);
            groups?.delete(group);
            if (groups?.size === 0) this.byUuid.delete(uuid);
        }
        group.uuids = [];
    }

    index(group, uuids) {
        this.unindex(group);
        group.uuids = [...new Set(uuids)];
        for (const uuid of group.uuids) {
            let groups = this.byUuid.get(uuid);
            if (!groups) this.byUuid.set(uuid, groups = new Set());
            groups.add(group);
        }
    }

    notify(uuid, message = 'refresh') {
        // Initial jobs have not resolved their names to UUIDs yet. An event
        // during that read requires one conservative read after registration.
        this.notifications++;
        const groups = this.byUuid.get(uuid);
        if (!groups) return;
        for (const group of groups) {
            if (message === 'reloadPage') {
                group.revision++;
                group.dirty = false;
                group.message = null;
                group.failed = false;
                group.nextAt = this.now() + this.refreshMs;
                this.pending.delete(group);
                group.controller?.abort();
                for (const client of group.clients) this.send(client, 'reloadPage');
            } else this.request(group, false);
        }
        this.drain();
    }

    request(group, drain = true) {
        if (!this.isCurrent(group)) return;
        if (group.running) { group.dirty = true; return; }
        if (group.failed && group.nextAt !== null && group.nextAt > this.now()) return;
        group.nextAt = null;
        this.pending.add(group);
        if (drain) this.drain();
    }

    isCurrent(group) {
        return !this.closed && this.groups.get(group.subscription.key) === group && group.clients.size > 0;
    }

    drain() {
        while (!this.closed && this.active < this.concurrency && this.pending.size) {
            const group = this.pending.values().next().value;
            this.pending.delete(group);
            if (!this.isCurrent(group)) continue;
            void this.run(group);
        }
        this.arm();
    }

    async run(group) {
        this.active++;
        group.running = true;
        group.dirty = false;
        const revision = group.revision;
        const initial = group.uuids.length === 0;
        const notifications = this.notifications;
        const controller = new AbortController();
        group.controller = controller;
        try {
            const snapshot = await this.fetchSnapshot(group.subscription, controller.signal);
            if (!this.isCurrent(group) || revision !== group.revision) return;
            if (!snapshot || !Array.isArray(snapshot.uuids) || snapshot.uuids.length < 1
                || snapshot.uuids.length > 20 || snapshot.uuids.some(uuid => typeof uuid !== 'string'
                    || !/^[A-Za-z0-9_-]{1,64}$/.test(uuid))
                || !snapshot.data || typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)
                || snapshot.data.error) throw new Error('Invalid overlay snapshot');
            const message = JSON.stringify({type: 'snapshot', version: 1,
                sequence: ++group.sequence, data: snapshot.data});
            if (Buffer.byteLength(message) > this.maxBytes) throw new Error('Overlay snapshot exceeds limit');
            this.index(group, snapshot.uuids);
            group.message = message;
            group.failed = false;
            group.nextAt = this.now() + this.refreshMs;
            for (const client of group.clients) this.send(client, message);
            if (initial && notifications !== this.notifications) group.dirty = true;
        } catch (error) {
            if (this.isCurrent(group) && revision === group.revision) {
                // Keep the last successful value visible. One transition
                // signal enables browser fallback without a retry stampede.
                if (!group.failed) {
                    group.failed = true;
                    for (const client of group.clients) this.send(client, this.errorMessage);
                    this.onError(error);
                }
                group.nextAt = this.now() + this.retryMs;
                group.dirty = false;
            }
        } finally {
            this.active--;
            group.running = false;
            group.controller = null;
            // A refresh following a reload belongs to the new revision, even
            // when the aborted older request has not settled yet.
            if (this.isCurrent(group) && group.dirty) this.request(group);
            this.drain();
        }
    }

    arm() {
        if (this.timer !== null) this.cancel(this.timer);
        this.timer = null;
        if (this.closed) return;
        let nextAt = Infinity;
        for (const group of this.groups.values()) {
            if (!group.running && !this.pending.has(group) && group.nextAt !== null) {
                nextAt = Math.min(nextAt, group.nextAt);
            }
        }
        if (!Number.isFinite(nextAt)) return;
        this.timer = this.schedule(() => {
            this.timer = null;
            const now = this.now();
            // The same concurrency/queue limit paces rolling-window refreshes.
            for (const group of this.groups.values()) {
                if (!group.running && group.nextAt !== null && group.nextAt <= now) {
                    group.nextAt = null;
                    this.pending.add(group);
                }
            }
            this.drain();
        }, Math.max(0, nextAt - this.now()));
        this.timer.unref?.();
    }

    clear() {
        this.closed = true;
        if (this.timer !== null) this.cancel(this.timer);
        this.timer = null;
        for (const group of this.groups.values()) {
            group.revision++;
            group.controller?.abort();
            group.message = null;
        }
        this.groups.clear();
        this.byClient.clear();
        this.byUuid.clear();
        this.pending.clear();
    }
}
