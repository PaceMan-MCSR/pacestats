/** Docker only: single-split rows preserve every consumed value and public history shape. */
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {getAllPlayerRunsByPeriod, getConn, getSplitRunsByPeriod} from "../app/data";
import {GET} from "../app/api/getSplitStats/route";

async function main() {
    const uuid = "e4cd494a-4e0a-423b-9988-618b86858c96", connection = await getConn();
    const [names] = await connection.execute<any[]>("SELECT nickname FROM pace WHERE uuid=? ORDER BY id DESC LIMIT 1", [uuid]);
    const consumed: Record<string, string[]> = {nether: ["nether"], bastion: ["bastion"], fortress: ["fortress", "obtainRod"],
        first_structure: ["bastion", "fortress", "obtainRod"], second_structure: ["id", "bastion", "fortress", "obtainRod"],
        first_portal: ["first_portal"], stronghold: ["stronghold"], end: ["end"], finish: ["finish"]};
    const cpu = process.cpuUsage(), started = performance.now();
    const before = await getAllPlayerRunsByPeriod(uuid, 9_999) as any[];
    const beforeCpu = process.cpuUsage(cpu), baseline = {durationMs: performance.now() - started,
        cpuMs: (beforeCpu.user + beforeCpu.system) / 1_000, columns: Object.keys(before[0]).length, bytes: Buffer.byteLength(JSON.stringify(before))};
    let afterMetrics = {};
    for (const [split, keys] of Object.entries(consumed)) {
        const cpu = process.cpuUsage(), started = performance.now();
        const after = await getSplitRunsByPeriod(uuid, 9_999, split);
        const used = process.cpuUsage(cpu);
        if (split === "nether") afterMetrics = {durationMs: performance.now() - started,
            cpuMs: (used.user + used.system) / 1_000, columns: Object.keys(after[0]).length, bytes: Buffer.byteLength(JSON.stringify(after))};
        assert.deepEqual(after, before.map((run) => Object.fromEntries([...keys, "time"].map((key) => [key, run[key]]))));
        const response = await GET(new NextRequest(`http://localhost/stats/api/getSplitStats?name=${names[0].nickname}&hours=9999999&hoursBetween=9999999&split=${split}`));
        assert.equal(response.status, 200);
        const result = await response.json();
        assert.ok(result.count >= 0 && Number.isFinite(result.ms));
    }
    await assert.rejects(getSplitRunsByPeriod(uuid, 1, "nether FROM pace; --"), /Unsupported split/);
    console.log(JSON.stringify({case: "single-split-projection", rows: before.length, parityCases: 9, before: baseline, after: afterMetrics}));
}

main().then(() => process.exit(0), (error) => {console.error(error); process.exit(1);});
