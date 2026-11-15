/** Docker only: compare pushed snapshots to a frozen public API against local MySQL/Redis. */
import assert from "node:assert/strict";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {NextRequest} from "next/server";
import {GET as snapshot} from "../app/api/obsSnapshot/route";

const loadRoute = async (name: string) => {
    const source = await import(pathToFileURL(resolve(
        process.env.PERF_BASELINE_SOURCE ?? "/tmp/pacestats-round4-final", "app/api", name, "route.ts"
    )).href);
    return (source.default ?? source).GET;
};

async function main() {
    const cases = [
        ["session", "getSessionStats", "name=NoFearr1337&hours=24&hoursBetween=6"],
        ["session", "getSessionStats", "name=NoFearr1337&hours=239976&hoursBetween=239976"],
        ["session", "getSessionStats", "name=NoFearr1337&hours=239976&hoursBetween=0"],
        ["nethers", "getSessionNethers", "name=NoFearr1337&hours=24&hoursBetween=6&dp=3"],
        ["nethers", "getSessionNethers", "name=NoFearr1337&hours=239976&hoursBetween=239976&dp=0"],
        ["nethers", "getSessionNethers", "name=NoFearr1337&hours=239976&hoursBetween=6&liveOnly=true&dp=1"],
        ["nethers", "getSessionNethers", "name=NoFearr1337&hours=9999999&hoursBetween=9999999&dp=2"],
        ["combinedStats", "getCombinedStats", "names=NoFearr1337,CroProYT&hours=24&hoursBetween=6"],
        ["combinedStats", "getCombinedStats", "names=NoFearr1337,NoFearr1337,CroProYT&hours=239976&hoursBetween=239976"],
        ["combinedNethers", "getCombinedNethers", "names=NoFearr1337,CroProYT&hours=239976&hoursBetween=6&maxTime=150000"],
        ["combinedNethers", "getCombinedNethers", "names=NoFearr1337,CroProYT&hours=239976&hoursBetween=239976&start=1730000000"],
    ];
    let totalBytes = 0;
    for (const [kind, endpoint, query] of cases) {
        const reference = await (await loadRoute(endpoint))(new NextRequest(`http://localhost/stats/api/${endpoint}?${query}`));
        const current = await snapshot(new NextRequest(`http://localhost/stats/api/obsSnapshot?kind=${kind}&${query}`, {
            headers: {authorization: `Bearer ${process.env.WS_TOKEN}`},
        }));
        assert.equal(current.status, reference.status, `${kind} ${query}`);
        assert.equal(current.status, 200);
        assert.match(current.headers.get("cache-control")!, /no-store/);
        const bodyText = await current.text();
        const body = JSON.parse(bodyText);
        const expected = await reference.json();
        assert.deepEqual(body.data, expected, `${kind} ${query}`);
        const {GET: publicGet} = await import(`../app/api/${endpoint}/route`);
        const publicResponse = await publicGet(new NextRequest(`http://localhost/stats/api/${endpoint}?${query}`));
        assert.equal(publicResponse.status, 200);
        assert.deepEqual(await publicResponse.json(), expected, `public ${kind} ${query}`);
        assert.ok(body.uuids.length >= 1 && body.uuids.length <= 2);
        assert.ok(Buffer.byteLength(bodyText) <= 32 * 1024);
        totalBytes += Buffer.byteLength(bodyText);
        console.log(JSON.stringify({kind, query, bytes: Buffer.byteLength(bodyText), uuids: body.uuids.length}));
    }
    console.log(`OBS snapshot parity: ${cases.length} snapshot and ${cases.length} public current/frozen API pairs match exactly (${totalBytes} total snapshot bytes)`);
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
