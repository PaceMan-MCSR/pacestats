/** Docker only: docker exec pacestats-dev node --import tsx tests/backend-performance.ts */
import assert from "node:assert/strict";
import {getAllPBs, getConn, getPBs, getPlayerRunsOffsetPage, type PlayerRunFilter, type PlayerRunSort} from "../app/data";

const uuid = process.env.PERF_TEST_UUID ?? "e4cd494a-4e0a-423b-9988-618b86858c96";

async function verifyRunPages() {
    const coldHeap = process.memoryUsage().heapUsed;
    const coldStart = performance.now();
    const first = await getPlayerRunsOffsetPage(uuid);
    console.log(JSON.stringify({case: "cold-run-page", ms: performance.now() - coldStart,
        heapDeltaBytes: process.memoryUsage().heapUsed - coldHeap, returned: first.rows.length, total: first.rowCount}));
    // The reference deliberately reads the complete authoritative history once.
    // Production pagination must return the same result while transferring only a page.
    const [reference] = await (await getConn()).execute<any[]>(
        `SELECT id, nether, bastion, fortress,
            COALESCE(LEAST(bastion, fortress), bastion, fortress) AS first_structure,
            GREATEST(bastion, fortress) AS second_structure,
            first_portal, stronghold, \`end\`, finish,
            UNIX_TIMESTAMP(lastUpdated) * 1000 AS lastUpdated, vodId, twitch
         FROM pace WHERE uuid=?;`, [uuid]);
    assert.equal(first.rowCount, reference.length);
    const value = (row: any, column: string): number | null => {
        const raw = row[column === "date" ? "lastUpdated" : column];
        return raw == null ? null : Number(raw);
    };
    const matches = (row: any, filter: PlayerRunFilter) => {
        const actual = value(row, filter.column);
        if (filter.operatorValue === "isNotEmpty") return actual !== null;
        if (filter.operatorValue === "isEmpty") return actual === null;
        if (actual === null) return false;
        if (filter.operatorValue === "during") return actual >= filter.value! && actual < filter.endValue!;
        if (filter.operatorValue === "lessThan") return actual < filter.value!;
        if (filter.operatorValue === "greaterThan") return actual > filter.value!;
        if (filter.operatorValue === "before") return actual <= filter.value!;
        return actual >= filter.value!;
    };
    const date = Number(reference[Math.floor(reference.length / 2)]?.lastUpdated ?? Date.now());
    const cases: {filters: PlayerRunFilter[]; sort: PlayerRunSort; page: number}[] = [];
    for (const column of ["date", "nether", "bastion", "fortress", "first_structure", "second_structure",
        "first_portal", "stronghold", "end", "finish"] as const) {
        for (const direction of ["asc", "desc"] as const) {
            cases.push({filters: [], sort: {column, direction}, page: 0});
        }
    }
    for (const filter of [
        {column: "finish", operatorValue: "isNotEmpty"},
        {column: "finish", operatorValue: "isEmpty"},
        {column: "first_structure", operatorValue: "lessThan", value: 250_000},
        {column: "second_structure", operatorValue: "greaterThan", value: 400_000},
        {column: "date", operatorValue: "during", value: date, endValue: date + 30 * 86_400_000},
        {column: "date", operatorValue: "before", value: date},
        {column: "date", operatorValue: "after", value: date},
    ] as PlayerRunFilter[]) {
        cases.push({filters: [filter], sort: {column: "date", direction: "desc"}, page: 0});
    }
    cases.push({filters: [{column: "finish", operatorValue: "isNotEmpty"},
        {column: "nether", operatorValue: "lessThan", value: 300_000}], sort: {column: "finish", direction: "asc"}, page: 1});
    cases.push({filters: [], sort: {column: "date", direction: "desc"}, page: 5});
    cases.push({filters: [], sort: {column: "date", direction: "desc"}, page: 1_000_000});
    for (const test of cases) {
        const expected = reference.filter((row) => test.filters.every((filter) => matches(row, filter)));
        expected.sort((left, right) => {
            const a = value(left, test.sort.column), b = value(right, test.sort.column);
            if (a === null && b !== null) return 1;
            if (a !== null && b === null) return -1;
            if (a !== null && b !== null && a !== b) return test.sort.direction === "asc" ? a - b : b - a;
            return Number(right.id) - Number(left.id);
        });
        const actual = await getPlayerRunsOffsetPage(uuid, test.page, 25, test.filters, test.sort);
        assert.equal(actual.rowCount, expected.length, JSON.stringify(test));
        assert.deepEqual(actual.rows.map((row) => row.id), expected.slice(test.page * 25, test.page * 25 + 25).map((row) => row.id), JSON.stringify(test));
    }
    assert.deepEqual(await getPlayerRunsOffsetPage("no-such-player"), {rows: [], rowCount: 0});
    console.log(`Run pagination: ${cases.length + 2} correctness cases passed`);
}

async function verifyPBs() {
    const started = performance.now();
    const selected = await getPBs([], [uuid]);
    console.log(JSON.stringify({case: "cold-filtered-pb", ms: performance.now() - started, returned: selected.length}));
    const all = await getAllPBs();
    assert.deepEqual(selected, all.filter((row: any) => row.uuid === uuid));
    const ids = [...new Set([uuid, ...all.slice(0, 6).map((row: any) => row.uuid)])];
    assert.deepEqual(await getPBs([], [...ids, ids[0]]), all.filter((row: any) => ids.includes(row.uuid)));
    const names = all.slice(0, 6).map((row: any) => row.name).filter(Boolean);
    assert.deepEqual(await getPBs(names, ["ignored-uuid"]), all.filter((row: any) => names.includes(row.name)));
    assert.deepEqual(await getPBs(["no-such-player"], []), []);
    assert.deepEqual(await getPBs([], ["no-such-player"]), []);
    console.log("Filtered PBs: 5 parity cases passed against complete PB result");
}

async function main() {
    await verifyRunPages();
    await verifyPBs();
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
