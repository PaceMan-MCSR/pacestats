/** Docker only: verifies costly requests are rejected before fetching any rows. */
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {ApiInputError, withApiRequest} from "../app/api/_utils";

async function main() {
    const cases = [
        ["getRunsPaginated", "page=NaN"], ["getRunsPaginated", "pageSize=10001"],
        ["getRecentRuns", "name=NoFearr1337&limit=1001"],
        ["getRecentTimestamps", "name=NoFearr1337&limit=-1"],
        ["getNPH", "name=NoFearr1337&hours=0"],
        ["getSessionStats", "name=NoFearr1337&hours=invalid"],
        ["getSessionNethers", "name=NoFearr1337&dp=-1"],
        ["getSplitStats", "name=NoFearr1337&split=unknown"],
        ["getCombinedStats", `names=${Array.from({length: 21}, (_, i) => `player${i}`).join(",")}`],
        ["getCombinedNethers", "names=NoFearr1337&maxTime=100000000"],
        ["getLeaderboard", "category=unknown"], ["getFastest", "limit=-1"],
        ["getPBs", `names=${Array.from({length: 101}, (_, i) => `player${i}`).join(",")}`],
    ];
    for (const [endpoint, query] of cases) {
        const {GET} = await import(`../app/api/${endpoint}/route`);
        const response = await GET(new NextRequest(`http://localhost:5050/stats/api/${endpoint}?${query}`));
        assert.equal(response.status, 400, `${endpoint}?${query}`);
    }
    const request = new NextRequest("http://localhost:5050/stats/api/perf-fixture");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {release = resolve;});
    const handler = withApiRequest("perf-concurrency-fixture", async () => {
        await waiting;
        return Response.json({ok: true});
    }, {concurrent: 2});
    const first = handler(request), second = handler(request);
    assert.equal((await handler(request)).status, 429);
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    assert.equal((await handler(request)).status, 200);
    const failing = withApiRequest("perf-error-fixture", async () => {throw new ApiInputError("invalid");}, {concurrent: 1});
    assert.equal((await failing(request)).status, 400);
    assert.equal((await failing(request)).status, 400);
    console.log(`API limits: ${cases.length} early-validation cases and concurrency/recovery cases passed`);
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
