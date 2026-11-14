/** Isolated local Docker Redis DB14 only; primary application cache is untouched. */
import assert from "node:assert/strict";
import Redis from "ioredis";

process.env.REDIS_URL = "redis://127.0.0.1:6379/14";
const fixture = new Redis(process.env.REDIS_URL);
const primary = new Redis("redis://127.0.0.1:6379/0");
const fixtureKeys = ["leaderboards:1day", "fastestLeaderboards:1day"];
const createdKeys: string[] = [];

async function main() {
    for (const key of fixtureKeys) assert.equal(await fixture.exists(key), 0, `Reserved fixture key ${key} already exists`);
    const data = await import("../app/data");
    const {CategoryType, getMinQty} = await import("../app/utils");
    const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96";
    const start = performance.now();
    const profile = await data.fetchPlayerStatsFromRedis(uuid, 9999) as Record<string, Record<number, {value: number; ranking: number}>>;
    const referenceRaw = await primary.call("JSON.GET", `playerStats:${uuid}:9999day`, "$");
    assert.ok(referenceRaw, "Primary cache must contain the independent full-job reference");
    const reference = JSON.parse(String(referenceRaw))[0];
    for (const [category, filters] of Object.entries(profile)) {
        for (const [filter, actual] of Object.entries(filters)) {
            const expected = reference[category][filter];
            assert.ok(expected, `${category}/${filter} is absent in the complete-job result`);
            assert.ok(Math.abs(actual.value - expected.value) < 1e-8, `${category}/${filter}: ${actual.value} !== ${expected.value}`);
            assert.equal(actual.ranking, -1);
        }
    }
    console.log(JSON.stringify({case: "redis-empty-lifetime-profile", ms: performance.now() - start,
        categories: Object.keys(profile).length}));
    await assert.rejects(data.getTrimmedLeaderboards(30), {code: "CACHE_NOT_READY"});
    const {validationErrorResponse} = await import("../app/api/_utils");
    const unavailable = validationErrorResponse(new data.CacheNotReadyError())!;
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "30");

    const categories = Object.keys(profile);
    const board: Record<number, Record<string, any[]>> = {};
    for (const filter of [0, 1, 2, 3]) {
        board[filter] = {};
        for (const category of categories) {
            board[filter][category] = Array.from({length: 1_000}, (_, index) => ({
                uuid: index === 30 ? uuid : `fixture-${index}`, name: `Fixture ${index}`,
                qty: index < 20 ? 1 : 50, value: index + 1, avg: index + 1,
            }));
        }
    }
    await fixture.call("JSON.SET", "leaderboards:1day", "$", JSON.stringify(board));
    createdKeys.push("leaderboards:1day");
    for (const filter of [CategoryType.COUNT, CategoryType.AVG, CategoryType.CONVERSION]) {
        const actual = await data.fetchLeaderboardCategoryFromRedis(1, "nether", filter, 10, 5);
        const expected = board[filter].nether.filter((row) => filter === CategoryType.COUNT || row.qty >= 5).slice(0, 10);
        assert.deepEqual(actual, expected);
    }
    // The only eligible entries are in later prefixes, exercising continuation.
    assert.deepEqual(await data.fetchLeaderboardCategoryFromRedis(1, "nether", CategoryType.AVG, 100, 100), []);
    const reconstructed = await data.getTrimmedLeaderboards(1);
    for (const filter of [0, 1, 2, 3]) {
        for (const category of categories) {
            const minimum = [CategoryType.AVG, CategoryType.CONVERSION].includes(filter) ? getMinQty(category, 1) : 0;
            assert.deepEqual(reconstructed[filter][category], board[filter][category].filter((row) => row.qty >= minimum).slice(0, 10));
        }
    }
    const recoveredProfile = await data.fetchPlayerStatsFromRedis(uuid, 1);
    assert.equal(recoveredProfile.nether[CategoryType.COUNT].value, 31);
    assert.equal(recoveredProfile.nether[CategoryType.COUNT].ranking, -1);
    console.log("Cold cache: SQL profile parity, controlled503, bounded category reads, compact-board recovery and profile recovery passed");
}

main().then(() => 0, (error) => {console.error(error); return 1;}).then(async (code) => {
    if (createdKeys.length > 0) await fixture.del(...createdKeys);
    fixture.disconnect();
    primary.disconnect();
    process.exit(code);
});
