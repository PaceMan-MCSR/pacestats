/** Docker only: actual 100/200-row AA pages retain markup with smaller hydration props. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {brotliCompressSync} from "node:zlib";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import React, {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import AARecentRuns from "../app/player/[nick]/runs/aa/AARecentRuns";
import {getAAPlayerRunsPage, getAllNamesByNick} from "../app/data";
import {recentRunRows, type RecentRunRow} from "../app/components/profile/recentRunPresentation";
import {formatIfNotNull} from "../app/utils";

async function main() {
    const source = await import(pathToFileURL(resolve(
        process.env.PERF_BASELINE_SOURCE ?? "/tmp/pacestats-bundles-baseline",
        "app/player/[nick]/runs/aa/AARecentRuns.tsx"
    )).href);
    const Baseline = source.default?.default ?? source.default ?? source;
    const identity = await getAllNamesByNick("CroProYT");
    assert.ok(identity);
    const first = await getAAPlayerRunsPage(identity.uuid, null, 100);
    assert.equal(first.rows.length, 100);
    assert.ok(first.nextCursor);
    const second = await getAAPlayerRunsPage(identity.uuid, first.nextCursor, 100);
    assert.equal(second.rows.length, 100);
    const splits = ["nether", "bastion", "fortress", "stronghold", "end", "elytra", "credits", "finish"];
    const now = Date.now;
    const instant = now();
    // Frozen source is outside this checkout's tsconfig; tsx can emit classic
    // JSX for that copy. Supply its React binding only during this comparison.
    const runtime = globalThis as typeof globalThis & {React?: typeof React};
    const previousReact = runtime.React;
    runtime.React = React;
    Date.now = () => instant;
    try {
        const sizes = [];
        for (const rows of [first.rows, [...first.rows, ...second.rows]]) {
            const raw: {rows: any[]; nextCursor: number | null; hasMore: boolean; loadedCount: number} = {
                rows, nextCursor: first.nextCursor, hasMore: first.hasMore, loadedCount: rows.length,
            };
            const projected: {rows: RecentRunRow[]; nextCursor: number | null; hasMore: boolean} = {
                rows: recentRunRows(rows, true), nextCursor: raw.nextCursor, hasMore: raw.hasMore,
            };
            for (const [index, row] of projected.rows.entries()) {
                assert.equal(row.id, rows[index].id);
                assert.equal(row.time, Number(rows[index].lastUpdated) / 1000);
                assert.equal(row.live, rows[index].twitch !== null);
                assert.deepEqual(row.cells, splits.map(split => formatIfNotNull(rows[index][split])));
            }
            const previous = renderToStaticMarkup(createElement(Baseline, {uuid: identity.uuid, initialPage: raw}));
            const current = renderToStaticMarkup(createElement(AARecentRuns, {uuid: identity.uuid, initialPage: projected}));
            assert.equal(current, previous, "All header/cell/timer/live-marker/button markup remains byte-identical");
            const before: Buffer = Buffer.from(JSON.stringify(raw)), after: Buffer = Buffer.from(JSON.stringify(projected));
            assert.ok(after.length < before.length);
            sizes.push({rows: rows.length, rawBytes: before.length, projectedBytes: after.length,
                rawBrotliBytes: brotliCompressSync(before).length, projectedBrotliBytes: brotliCompressSync(after).length,
                htmlBytes: Buffer.byteLength(current), htmlHash: createHash("sha256").update(current).digest("hex")});
        }
        console.log(JSON.stringify({case: "AA history presentation", parity: "byte-identical SSR for actual100/200rows; publicAPIunchanged", sizes}));
    } finally {
        Date.now = now;
        if (previousReact) runtime.React = previousReact;
        else Reflect.deleteProperty(runtime, "React");
    }
}

main().then(() => process.exit(0), error => {console.error(error); process.exit(1);});
