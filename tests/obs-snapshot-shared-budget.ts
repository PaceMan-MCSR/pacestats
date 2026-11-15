/** Docker only: independently loaded SSR/provider modules share one process read budget. */
import assert from "node:assert/strict";
import {copyFile, mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {NextRequest} from "next/server";
import {getCached} from "../app/data";
import {ApiInputError} from "../app/api/_utils";
import {GET} from "../app/api/obsSnapshot/route";
import {OverlaySnapshotError, readOverlaySnapshot} from "../app/obs/snapshot.server";

async function main() {
    const directory = await mkdtemp(join(tmpdir(), "pacestats-obs-cap-"));
    const copiedFile = join(directory, "snapshot.server.ts");
    await copyFile(resolve("app/obs/snapshot.server.ts"), copiedFile);
    const source = await import(pathToFileURL(copiedFile).href);
    const independent = source.default ?? source;
    assert.notEqual(independent.readOverlaySnapshot, readOverlaySnapshot, "Use a second module instance, as separate Next.js bundles can");
    const runtime = globalThis as typeof globalThis & {__paceStatsDbPool: any; __paceStatsActiveOverlaySnapshots?: number};
    assert.equal(runtime.__paceStatsActiveOverlaySnapshots ?? 0, 0);
    const pool = runtime.__paceStatsDbPool, acquire = pool.getConnection.bind(pool);
    const oldToken = process.env.WS_TOKEN;
    process.env.WS_TOKEN = "local-shared-budget-fixture";
    const normal = "kind=session&name=SharedBudgetFixture";
    const params = (query = normal) => new URLSearchParams(query);
    const request = (authorized = true) => new NextRequest(`http://localhost/stats/api/obsSnapshot/?${normal}`, {
        headers: authorized ? {authorization: `Bearer ${process.env.WS_TOKEN}`} : {},
    });
    let queries = 0, fail = false, release!: () => void;
    const waiting = new Promise<void>(resolve => {release = resolve;});
    pool.getConnection = async () => {
        const connection = await acquire(), execute = connection.execute.bind(connection);
        connection.execute = async (options: {sql: string}) => {
            connection.execute = execute;
            queries++;
            assert.match(options.sql, /WHERE uuid=\?/);
            assert.match(options.sql, /LIMIT \?/);
            await waiting;
            if (fail) throw new Error("Injected shared snapshot read failure");
            return [[{id: 500_001, nether: 100_000, bastion: null, fortress: null, first_portal: null,
                stronghold: null, end: null, finish: null, obtainRod: null, time: Math.floor(Date.now() / 1000)}], []];
        };
        return connection;
    };
    try {
        await getCached(async () => ({uuid: "shared-budget-uuid", nick: "SharedBudgetFixture"}), "getAllNamesByNick", "SharedBudgetFixture");
        const first = readOverlaySnapshot(params());
        const second = GET(request());
        const third = independent.readOverlaySnapshot(params());
        const fourth = readOverlaySnapshot(params("kind=nethers&name=SharedBudgetFixture&nph=false"));
        for (let index = 0; queries < 4 && index < 100; index++) await new Promise(resolve => setTimeout(resolve, 5));
        assert.equal(queries, 4);
        assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 4);
        const denied = await GET(request(false));
        assert.equal(denied.status, 401, "Authentication still precedes the shared budget");
        await assert.rejects(readOverlaySnapshot(params()), error => error instanceof OverlaySnapshotError && error.status === 429);
        await assert.rejects(independent.readOverlaySnapshot(params()), (error: any) => error.status === 429);
        const busy = await GET(request());
        assert.equal(busy.status, 429);
        assert.equal(busy.headers.get("retry-after"), "1");
        await assert.rejects(readOverlaySnapshot(params("kind=session&name=x&hours=0")), error => error instanceof ApiInputError);
        assert.equal(queries, 4, "Rejected SSR/provider work cannot acquire extra SQL connections");
        release();
        const [ssr, provider, otherBundle, nethers] = await Promise.all([first, second, third, fourth]);
        assert.equal(provider.status, 200);
        assert.deepEqual(await provider.json(), ssr);
        assert.deepEqual(otherBundle, ssr);
        assert.deepEqual(ssr.uuids, ["shared-budget-uuid"]);
        assert.deepEqual(ssr.data.nether, {count: 1, avg: "1:40"});
        assert.deepEqual(nethers.data, {count: 1, avg: "1:40", rnph: 0, uuid: "shared-budget-uuid"});
        assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 0);
        fail = true;
        await assert.rejects(independent.readOverlaySnapshot(params()), /Injected shared snapshot read failure/);
        assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 0, "A failed read releases the process budget");
        fail = false;
        assert.deepEqual(await readOverlaySnapshot(params()), ssr);
        assert.equal(runtime.__paceStatsActiveOverlaySnapshots, 0);
    } finally {
        release();
        pool.getConnection = acquire;
        if (oldToken === undefined) delete process.env.WS_TOKEN;
        else process.env.WS_TOKEN = oldToken;
        await rm(directory, {recursive: true, force: true});
    }
    console.log("OBS shared snapshot budget: SSR, authenticated provider and independent module copies share four reads, exact data, early validation, auth-first rejection and failure recovery");
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
