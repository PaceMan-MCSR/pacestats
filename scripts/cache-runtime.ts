import { createHash, randomUUID } from "node:crypto";
import type Redis from "ioredis";

const publishCommandRegistered = new WeakSet<object>();

export interface StagedKey {
    target: string;
    staging: string;
}

export interface RedisLease {
    key: string;
    token: string;
    assertHeld: () => void;
    verifyHeld: () => Promise<void>;
    release: () => Promise<void>;
}

export class LockUnavailableError extends Error {
    constructor(key: string) {
        super(`Another cache process already owns '${key}'.`);
        this.name = "LockUnavailableError";
    }
}

export function envInt(name: string, fallback: number, minimum = 1): number {
    const parsed = Number.parseInt(process.env[name] || "", 10);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function assertRedisResults(results: unknown, operation: string): void {
    if (!Array.isArray(results)) {
        throw new Error(`${operation} returned no Redis results.`);
    }

    const errors = results
        .map((result: any, index: number) => ({ index, error: result?.[0] }))
        .filter(({ error }) => error != null);

    if (errors.length > 0) {
        const summary = errors
            .slice(0, 5)
            .map(({ index, error }) => `#${index}: ${String(error)}`)
            .join("; ");
        throw new Error(`${operation} failed for ${errors.length} Redis command(s): ${summary}`);
    }
}

export async function acquireRedisLock(
    redis: Redis,
    key: string,
    ttlMs: number,
): Promise<RedisLease> {
    const token = randomUUID();
    const acquired = await redis.set(key, token, "PX", ttlMs, "NX");
    if (acquired !== "OK") {
        throw new LockUnavailableError(key);
    }

    let lost = false;
    let renewing = false;
    const renewEveryMs = Math.max(1_000, Math.floor(ttlMs / 3));
    const renewScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('PEXPIRE', KEYS[1], ARGV[2])
        end
        return 0
    `;
    const releaseScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
            return redis.call('DEL', KEYS[1])
        end
        return 0
    `;

    const timer = setInterval(async () => {
        if (renewing || lost) return;
        renewing = true;
        try {
            const renewed = await redis.eval(renewScript, 1, key, token, ttlMs);
            if (Number(renewed) !== 1) lost = true;
        } catch (error) {
            lost = true;
            console.error(`Failed to renew Redis lock '${key}':`, error);
        } finally {
            renewing = false;
        }
    }, renewEveryMs);
    timer.unref();

    return {
        key,
        token,
        assertHeld: () => {
            if (lost) throw new Error(`Redis lock '${key}' was lost while the job was running.`);
        },
        verifyHeld: async () => {
            if (lost || await redis.get(key) !== token) {
                lost = true;
                throw new Error(`Redis lock '${key}' was lost while the job was running.`);
            }
        },
        release: async () => {
            clearInterval(timer);
            try {
                await redis.eval(releaseScript, 1, key, token);
            } catch (error) {
                console.error(`Failed to release Redis lock '${key}':`, error);
            }
        },
    };
}

function stagingKey(generation: string, target: string): string {
    return `cache:staging:${generation}:${target}`;
}

export async function stageJsonEntries(
    redis: Redis,
    entries: Iterable<[string, unknown]>,
    generation: string,
    batchSize: number,
    stagingTtlSeconds: number,
): Promise<StagedKey[]> {
    const staged: StagedKey[] = [];
    let batch: Array<[string, unknown]> = [];

    const flush = async () => {
        if (batch.length === 0) return;
        const pipeline = redis.pipeline();
        for (const [target, value] of batch) {
            const staging = stagingKey(generation, target);
            pipeline.call("JSON.SET", staging, "$", JSON.stringify(value));
            pipeline.expire(staging, stagingTtlSeconds);
            staged.push({ target, staging });
        }
        assertRedisResults(await pipeline.exec(), `staging ${batch.length} JSON cache entries`);
        batch = [];
    };

    for (const entry of entries) {
        batch.push(entry);
        if (batch.length >= batchSize) await flush();
    }
    await flush();
    return staged;
}

/**
 * Content digests of the dynamic keys a job published, kept in one Redis hash
 * per scope (`target -> digest`). Unchanged values can then skip staging and
 * renaming entirely; only their TTL is renewed.
 */
export interface DigestLedger {
    key: string;
    previous: Map<string, string>;
    /** Digests of values staged in this run, to record after publishing. */
    changed: Map<string, string>;
}

export function contentDigest(serialized: string): string {
    return createHash("sha1").update(serialized).digest("base64");
}

export async function readDigestLedger(redis: Redis, key: string): Promise<DigestLedger> {
    const stored = await redis.hgetall(key);
    return {key, previous: new Map(Object.entries(stored)), changed: new Map()};
}

/**
 * Stage only the JSON entries whose serialized value differs from the last
 * published one. An entry with a matching digest is kept as it is when its
 * key still exists (its TTL is renewed, or it is persisted for ttl 0); a
 * missing key is staged again. Returns the staged keys and the targets kept.
 */
export async function stageChangedJsonEntries(
    redis: Redis,
    entries: Iterable<[string, unknown]>,
    generation: string,
    batchSize: number,
    stagingTtlSeconds: number,
    ledger: DigestLedger,
    targetTtlSeconds: number,
    lease: RedisLease,
): Promise<{staged: StagedKey[]; retained: string[]}> {
    const staged: StagedKey[] = [];
    const retained: string[] = [];
    let stageBatch: Array<[string, string]> = [];
    let keepBatch: Array<[string, string, string]> = [];
    const renewScript = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        local ttl = tonumber(ARGV[2])
        local missing = {}
        for index = 2, #KEYS do
            if redis.call('EXISTS', KEYS[index]) == 1 then
                if ttl > 0 then
                    redis.call('EXPIRE', KEYS[index], ttl)
                else
                    redis.call('PERSIST', KEYS[index])
                end
            else
                missing[#missing + 1] = index - 2
            end
        end
        return missing
    `;

    const flushStage = async () => {
        if (stageBatch.length === 0) return;
        const pipeline = redis.pipeline();
        for (const [target, serialized] of stageBatch) {
            const staging = stagingKey(generation, target);
            pipeline.call("JSON.SET", staging, "$", serialized);
            pipeline.expire(staging, stagingTtlSeconds);
            staged.push({target, staging});
        }
        assertRedisResults(await pipeline.exec(), `staging ${stageBatch.length} JSON cache entries`);
        stageBatch = [];
    };
    const flushKeep = async () => {
        if (keepBatch.length === 0) return;
        const batch = keepBatch;
        keepBatch = [];
        lease.assertHeld();
        const missing = new Set((await redis.eval(
            renewScript,
            batch.length + 1,
            lease.key,
            ...batch.map(([target]) => target),
            lease.token,
            String(targetTtlSeconds),
        ) as number[]).map(Number));
        lease.assertHeld();
        for (let index = 0; index < batch.length; index++) {
            const [target, serialized, digest] = batch[index];
            if (missing.has(index)) {
                ledger.changed.set(target, digest);
                stageBatch.push([target, serialized]);
            } else {
                retained.push(target);
            }
        }
        if (stageBatch.length >= batchSize) await flushStage();
    };

    for (const [target, value] of entries) {
        const serialized = JSON.stringify(value);
        const digest = contentDigest(serialized);
        if (ledger.previous.get(target) === digest) {
            keepBatch.push([target, serialized, digest]);
            if (keepBatch.length >= batchSize * 4) await flushKeep();
        } else {
            ledger.changed.set(target, digest);
            stageBatch.push([target, serialized]);
            if (stageBatch.length >= batchSize) await flushStage();
        }
    }
    await flushKeep();
    await flushStage();
    return {staged, retained};
}

const digestLedgerScript = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        if ARGV[2] == 'set' then
            for index = 3, #ARGV, 2 do redis.call('HSET', KEYS[2], ARGV[index], ARGV[index + 1]) end
        else
            for index = 3, #ARGV do redis.call('HDEL', KEYS[2], ARGV[index]) end
        end
        return 1
    `;

/**
 * Forget the recorded digests of every target about to be overwritten. Call
 * before publishing: if the job dies between publishing and recording the new
 * digests, a later run must not mistake the old digest for the live value.
 */
export async function forgetChangedDigests(
    redis: Redis,
    ledger: DigestLedger,
    lease: RedisLease,
    batchSize = 1_000,
): Promise<void> {
    const targets = [...ledger.changed.keys()].filter((target) => ledger.previous.has(target));
    for (let offset = 0; offset < targets.length; offset += batchSize) {
        lease.assertHeld();
        await redis.eval(digestLedgerScript, 2, lease.key, ledger.key, lease.token, "del",
            ...targets.slice(offset, offset + batchSize));
    }
    lease.assertHeld();
}

/**
 * Record the digests of the values just published and forget targets that no
 * longer exist. Call only after the staged values were published: a ledger
 * that lags behind Redis only causes a rewrite, never a skipped one.
 */
export async function writeDigestLedger(
    redis: Redis,
    ledger: DigestLedger,
    currentTargets: Iterable<string>,
    lease: RedisLease,
    batchSize = 1_000,
): Promise<void> {
    const current = new Set(currentTargets);
    const removed = [...ledger.previous.keys()].filter((target) => !current.has(target));
    const changed = [...ledger.changed].filter(([target]) => current.has(target));
    const script = digestLedgerScript;
    for (let offset = 0; offset < changed.length; offset += batchSize) {
        lease.assertHeld();
        await redis.eval(script, 2, lease.key, ledger.key, lease.token, "set",
            ...changed.slice(offset, offset + batchSize).flat());
    }
    for (let offset = 0; offset < removed.length; offset += batchSize) {
        lease.assertHeld();
        await redis.eval(script, 2, lease.key, ledger.key, lease.token, "del",
            ...removed.slice(offset, offset + batchSize));
    }
    lease.assertHeld();
}

export async function stageStringEntries(
    redis: Redis,
    entries: Iterable<[string, string]>,
    generation: string,
    batchSize: number,
    stagingTtlSeconds: number,
): Promise<StagedKey[]> {
    const staged: StagedKey[] = [];
    let batch: Array<[string, string]> = [];

    const flush = async () => {
        if (batch.length === 0) return;
        const pipeline = redis.pipeline();
        for (const [target, value] of batch) {
            const staging = stagingKey(generation, target);
            pipeline.set(staging, value, "EX", stagingTtlSeconds);
            staged.push({ target, staging });
        }
        assertRedisResults(await pipeline.exec(), `staging ${batch.length} string cache entries`);
        batch = [];
    };

    for (const entry of entries) {
        batch.push(entry);
        if (batch.length >= batchSize) await flush();
    }
    await flush();
    return staged;
}

export async function publishStagedEntries(
    redis: Redis,
    staged: StagedKey[],
    batchSize: number,
    targetTtlSeconds = 0,
    lease?: RedisLease,
    manifestKey?: string,
): Promise<void> {
    const guardedPublishScript = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        for index = 2, #KEYS, 2 do
            if redis.call('EXISTS', KEYS[index]) ~= 1 then
                return redis.error_reply('CACHE_STAGING_KEY_MISSING')
            end
        end
        if ARGV[3] ~= '' then
            local manifestType = redis.call('TYPE', ARGV[3]).ok
            if manifestType ~= 'none' and manifestType ~= 'set' then
                return redis.error_reply('CACHE_MANIFEST_WRONG_TYPE')
            end
        end
        local ttl = tonumber(ARGV[2])
        for index = 2, #KEYS, 2 do
            redis.call('RENAME', KEYS[index], KEYS[index + 1])
            if ttl > 0 then
                redis.call('EXPIRE', KEYS[index + 1], ttl)
            else
                redis.call('PERSIST', KEYS[index + 1])
            end
            if ARGV[3] ~= '' then
                redis.call('SADD', ARGV[3], KEYS[index + 1])
            end
        end
        return (#KEYS - 1) / 2
    `;

    if (lease && !publishCommandRegistered.has(redis)) {
        redis.defineCommand("cacheGuardedPublish", {lua: guardedPublishScript});
        publishCommandRegistered.add(redis);
    }

    for (let offset = 0; offset < staged.length; offset += batchSize) {
        const batch = staged.slice(offset, offset + batchSize);
        if (lease) {
            lease.assertHeld();
            const keys = [lease.key, ...batch.flatMap(({staging, target}) => [staging, target])];
            await (redis as any).cacheGuardedPublish(
                keys.length,
                ...keys,
                lease.token,
                String(targetTtlSeconds),
                manifestKey || "",
            );
            lease.assertHeld();
        } else {
            const transaction = redis.multi();
            for (const { target, staging } of batch) {
                transaction.rename(staging, target);
                if (targetTtlSeconds > 0) transaction.expire(target, targetTtlSeconds);
                else transaction.persist(target);
            }
            if (manifestKey) transaction.sadd(manifestKey, ...batch.map(({target}) => target));
            assertRedisResults(await transaction.exec(), `publishing ${batch.length} staged cache entries`);
        }
    }
}

export async function replaceManifest(
    redis: Redis,
    manifestKey: string,
    currentKeys: string[],
    deleteBatchSize: number,
    lease?: RedisLease,
    additionalKnownKeys: Iterable<string> = [],
    manifestBatchSize = deleteBatchSize,
): Promise<number> {
    const oldKeys = new Set(await redis.smembers(manifestKey));
    for (const key of additionalKnownKeys) oldKeys.add(key);
    const currentSet = new Set(currentKeys);
    const staleKeys = [...oldKeys].filter((key) => !currentSet.has(key));

    for (let offset = 0; offset < staleKeys.length; offset += deleteBatchSize) {
        const batch = staleKeys.slice(offset, offset + deleteBatchSize);
        if (lease) await deleteKeysIfLeaseHeld(redis, batch, lease);
        else if (batch.length > 0) await redis.del(...batch);
    }

    if (!lease) {
        const transaction = redis.multi().del(manifestKey);
        for (let offset = 0; offset < currentKeys.length; offset += manifestBatchSize) {
            const batch = currentKeys.slice(offset, offset + manifestBatchSize);
            if (batch.length > 0) transaction.sadd(manifestKey, ...batch);
        }
        assertRedisResults(await transaction.exec(), `replacing manifest '${manifestKey}'`);
        return staleKeys.length;
    }

    const stagingManifest = `cache:staging:manifest:${randomUUID()}`;
    for (let offset = 0; offset < currentKeys.length; offset += manifestBatchSize) {
        const batch = currentKeys.slice(offset, offset + manifestBatchSize);
        await lease.verifyHeld();
        const pipeline = redis.pipeline().sadd(stagingManifest, ...batch).expire(stagingManifest, 21_600);
        assertRedisResults(await pipeline.exec(), `staging manifest '${manifestKey}'`);
    }
    const swapManifestScript = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        if ARGV[2] == '1' then
            if redis.call('EXISTS', KEYS[2]) ~= 1 then
                return redis.error_reply('CACHE_STAGING_MANIFEST_MISSING')
            end
            redis.call('RENAME', KEYS[2], KEYS[3])
            redis.call('PERSIST', KEYS[3])
        else
            redis.call('DEL', KEYS[3])
        end
        return 1
    `;
    await redis.eval(
        swapManifestScript,
        3,
        lease.key,
        stagingManifest,
        manifestKey,
        lease.token,
        currentKeys.length > 0 ? "1" : "0",
    );
    lease.assertHeld();
    return staleKeys.length;
}

export async function deleteKeysIfLeaseHeld(
    redis: Redis,
    keys: string[],
    lease: RedisLease,
    manifestKey?: string,
): Promise<void> {
    if (keys.length === 0) return;
    lease.assertHeld();
    const script = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        if ARGV[2] ~= '' then
            local manifestType = redis.call('TYPE', ARGV[2]).ok
            if manifestType ~= 'none' and manifestType ~= 'set' then
                return redis.error_reply('CACHE_MANIFEST_WRONG_TYPE')
            end
        end
        for index = 2, #KEYS do
            redis.call('DEL', KEYS[index])
            if ARGV[2] ~= '' then redis.call('SREM', ARGV[2], KEYS[index]) end
        end
        return #KEYS - 1
    `;
    await redis.eval(script, keys.length + 1, lease.key, ...keys, lease.token, manifestKey || "");
    lease.assertHeld();
}

export async function addSetMembersIfLeaseHeld(
    redis: Redis,
    key: string,
    members: string[],
    lease: RedisLease,
): Promise<void> {
    if (members.length === 0) return;
    lease.assertHeld();
    const script = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        for index = 2, #ARGV do redis.call('SADD', KEYS[2], ARGV[index]) end
        return #ARGV - 1
    `;
    await redis.eval(script, 2, lease.key, key, lease.token, ...members);
    lease.assertHeld();
}

export async function removeSetMembersIfLeaseHeld(
    redis: Redis,
    key: string,
    members: string[],
    lease: RedisLease,
): Promise<void> {
    if (members.length === 0) return;
    lease.assertHeld();
    const script = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        for index = 2, #ARGV do redis.call('SREM', KEYS[2], ARGV[index]) end
        return #ARGV - 1
    `;
    await redis.eval(script, 2, lease.key, key, lease.token, ...members);
    lease.assertHeld();
}

export async function setHashIfLeaseHeld(
    redis: Redis,
    key: string,
    values: Record<string, string>,
    lease: RedisLease,
): Promise<void> {
    const fields = Object.entries(values).flat();
    lease.assertHeld();
    const script = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        for index = 2, #ARGV, 2 do
            redis.call('HSET', KEYS[2], ARGV[index], ARGV[index + 1])
        end
        return (#ARGV - 1) / 2
    `;
    await redis.eval(script, 2, lease.key, key, lease.token, ...fields);
    lease.assertHeld();
}

export async function setStringIfLeaseHeld(
    redis: Redis,
    key: string,
    value: string,
    lease: RedisLease,
): Promise<void> {
    lease.assertHeld();
    const script = `
        if redis.call('GET', KEYS[1]) ~= ARGV[1] then
            return redis.error_reply('CACHE_LOCK_LOST')
        end
        redis.call('SET', KEYS[2], ARGV[2])
        return 1
    `;
    await redis.eval(script, 2, lease.key, key, lease.token, value);
    lease.assertHeld();
}

export async function scanKeys(redis: Redis, pattern: string, count = 500): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
        const [nextCursor, page] = await redis.scan(cursor, "MATCH", pattern, "COUNT", count);
        cursor = nextCursor;
        keys.push(...page);
    } while (cursor !== "0");
    return keys;
}
