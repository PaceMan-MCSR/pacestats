/** Docker only: fake SQL execution verifies notifications without modifying stored runs. */
import assert from "node:assert/strict";
import {deleteRun, submitStats} from "../app/data";

async function main() {
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any; __paceStatsRedis: any};
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    const redis = runtime.__paceStatsRedis, publish = redis.publish.bind(redis), sadd = redis.sadd.bind(redis);
    const log = console.error;
    const events: string[] = [];
    let affectedRows = 1, hasUuid = true, failWrite = false, duplicateWrite = false, failPublish = false, failSadd = false;
    pool.getConnection = async () => {
        const connection = await acquire();
        const execute = connection.execute.bind(connection), begin = connection.beginTransaction.bind(connection);
        const commit = connection.commit.bind(connection), rollback = connection.rollback.bind(connection);
        const release = connection.release.bind(connection);
        connection.beginTransaction = async () => {events.push("begin");};
        connection.commit = async () => {events.push("commit");};
        connection.rollback = async () => {events.push("rollback");};
        connection.execute = async (options: {sql: string}) => {
            const sql = options.sql;
            events.push(sql.startsWith("SELECT") ? "select" : sql.startsWith("INSERT") ? "insert" : "delete");
            if (failWrite && !sql.startsWith("SELECT")) throw new Error("Injected authoritative write failure");
            if (duplicateWrite && sql.includes("INSERT INTO nethers")) throw Object.assign(new Error("Duplicate"), {code: "ER_DUP_ENTRY"});
            if (sql.startsWith("SELECT")) return [hasUuid ? [{uuid: "obs-mutation-fixture"}] : [], []];
            return [{affectedRows}, []];
        };
        connection.release = () => {
            connection.execute = execute;
            connection.beginTransaction = begin;
            connection.commit = commit;
            connection.rollback = rollback;
            connection.release = release;
            events.push("release");
            release();
        };
        return connection;
    };
    redis.publish = async (_channel: string, message: string) => {
        events.push("publish");
        assert.deepEqual(JSON.parse(message), {uuid: "obs-mutation-fixture"});
        if (failPublish) throw new Error("Injected Pub/Sub failure");
        return 1;
    };
    redis.sadd = async (...args: string[]) => {
        events.push("sadd");
        assert.deepEqual(args, ["cache:recent:dirty", "obs-mutation-fixture"]);
        if (failSadd) throw new Error("Injected invalidation failure");
        return 1;
    };
    console.error = () => undefined;
    const submit = () => submitStats("obs-mutation-fixture", -1, 1, 1, 1, 1, 1, 1);
    try {
        assert.equal(await submit(), true);
        assert.deepEqual(events, ["insert", "release", "publish"]);
        events.length = 0; affectedRows = 0;
        assert.equal(await submit(), false);
        assert.ok(!events.includes("publish"));
        events.length = 0; affectedRows = 1; duplicateWrite = true;
        assert.equal(await submit(), false);
        assert.ok(!events.includes("publish"));
        events.length = 0; duplicateWrite = false; failWrite = true;
        await assert.rejects(submit(), /authoritative write failure/);
        assert.ok(!events.includes("publish"));
        events.length = 0; failWrite = false; failPublish = true;
        assert.equal(await submit(), true, "An optional notification cannot reject a committed stats write");
        events.length = 0; failPublish = false;
        assert.equal(await deleteRun("-1"), true);
        assert.deepEqual(events, ["begin", "select", "insert", "delete", "delete", "commit", "release", "sadd", "publish"]);
        events.length = 0; hasUuid = false; affectedRows = 0;
        assert.equal(await deleteRun("-1"), false);
        assert.ok(events.includes("commit") && !events.includes("publish") && !events.includes("sadd"));
        events.length = 0; hasUuid = true; affectedRows = 1; failWrite = true;
        await assert.rejects(deleteRun("-1"), /authoritative write failure/);
        assert.ok(events.includes("rollback") && !events.includes("publish"));
        events.length = 0; failWrite = false; failSadd = true;
        assert.equal(await deleteRun("-1"), true);
        assert.ok(events.indexOf("publish") > events.indexOf("commit"), "A dirty-set failure cannot suppress the committed event");
        events.length = 0; failSadd = false; failPublish = true;
        assert.equal(await deleteRun("-1"), true, "An optional notification cannot reject a committed deletion");
    } finally {
        pool.getConnection = acquire;
        redis.publish = publish;
        redis.sadd = sadd;
        console.error = log;
    }
    console.log("OBS mutation notifications: committed insert/delete publish after commit, duplicates/rollback emit nothing, Redis failures preserve success; zero stored writes");
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
