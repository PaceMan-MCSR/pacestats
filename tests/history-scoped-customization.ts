/** Docker only: a cold history page resolves only its own customization. */
import assert from "node:assert/strict";
import {Children, isValidElement} from "react";
import {createRequire} from "node:module";
import {resolve} from "node:path";

async function main() {
    // Isolate the cold Redis fallback without altering published data.
    process.env.REDIS_URL = "redis://127.0.0.1:6379/15";
    const {getAllUserInfo, getConn} = await import("../app/data");
    // The page imports client controls with CSS. This SQL/element-prop check
    // leaves CSS to the production browser suite rather than parsing it in Node.
    const fixtureRequire = createRequire(resolve("package.json"));
    const cssLoader = fixtureRequire.extensions[".css"];
    fixtureRequire.extensions[".css"] = () => undefined;
    let Page: typeof import("../app/player/[nick]/runs/page").default;
    try {({default: Page} = await import("../app/player/[nick]/runs/page"));}
    finally {
        if (cssLoader) fixtureRequire.extensions[".css"] = cssLoader;
        else delete fixtureRequire.extensions[".css"];
    }
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any; __paceStatsRedis: any};
    assert.equal(await runtime.__paceStatsRedis.dbsize(), 0);
    const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96";
    const reference = (await getAllUserInfo() as any[]).find(user => user.uuid === uuid);
    await (await getConn()).execute("SELECT 1;");
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    const userQueries: string[] = [];
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}, values: unknown[]) => {
            connection.execute = execute;
            if (/FROM users\b/i.test(options.sql)) {
                userQueries.push(options.sql);
                assert.match(options.sql, /WHERE uuid=\? LIMIT 1/);
                assert.deepEqual(values, [uuid]);
            }
            return execute(options, values);
        };
        return connection;
    };
    try {
        const tree = await Page({params: Promise.resolve({nick: "NoFearr1337"}), searchParams: Promise.resolve({})});
        const seeds: any[] = [];
        const visit = (node: unknown) => {
            if (!isValidElement<{children?: any; info?: any}>(node)) return;
            if (typeof node.type === "function" && node.type.name === "PlayerInfoSeed") seeds.push(node.props.info);
            Children.forEach(node.props.children, visit);
        };
        visit(tree);
        assert.deepEqual(seeds, [{id: uuid, displayName: reference?.displayName || null,
            color: reference?.color || null, bgColor: reference?.bgColor || null}]);
        assert.equal(userQueries.length, 1, "History reads one indexed customization row rather than all users");
        assert.equal(await runtime.__paceStatsRedis.dbsize(), 0);
        console.log("History customization: cold Redis renders identical player seed with one indexed UUID lookup and no global user query");
    } finally {pool.getConnection = acquire;}
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
