'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import {useRouter} from "next/navigation";
import {useEffect, useRef} from "react";
import {PrefetchKind} from "next/dist/client/components/router-reducer/router-reducer-types";
import {formatIfNotNull, numberWithCommas} from "@/app/utils";
import { OverlayTrigger, Tooltip } from "@/app/components/HoverTooltip";

function TooltipLine({tooltip, value}: {tooltip: string, value: string}) {
    return <OverlayTrigger overlay={
        <Tooltip className="nphTooltip">
            <p>{tooltip}</p>
        </Tooltip>
    } delay={{ show: 0, hide: 50 }}>
        <th>{value}</th>
    </OverlayTrigger>
}

export function Nethers({runs}: { runs: {} }) {
    const router = useRouter();
    const intentTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hoveredHref = useRef<string | null>(null);
    const prefetched = useRef(new Map<string, number>());
    const cancelIntent = () => {
        clearTimeout(intentTimer.current);
        hoveredHref.current = null;
    };
    useEffect(() => () => clearTimeout(intentTimer.current), []);
    const rowHref = (target: EventTarget) => {
        const row = target instanceof Element ? target.closest<HTMLTableRowElement>('tr[data-run]') : null;
        return row?.dataset.run ? `/run/${row.dataset.run}` : null;
    };
    const prefetch = (href: string) => {
        const now = Date.now();
        if ((prefetched.current.get(href) ?? 0) > now) return;
        for (const [path, expiresAt] of prefetched.current) {
            if (expiresAt <= now) prefetched.current.delete(path);
        }
        if (prefetched.current.size >= 64) {
            const oldest = prefetched.current.keys().next().value;
            if (oldest !== undefined) prefetched.current.delete(oldest);
        }
        prefetched.current.set(href, now + 30_000);
        router.prefetch(href, {kind: PrefetchKind.FULL});
    };
    return <div className="recentNethers">
        <div style={{textAlign: "center"}}>
            <h6>Hover headers for more info</h6>
        </div>
        <div className="liveDescription">
            <span className="liveIndicator"/>= Live
        </div>
        <table className="table table-dark table-bordered table-sm">
            <thead>
            <tr className="paceHeader">
                <TooltipLine tooltip={"Time of run"} value={"Time"}/>
                <TooltipLine tooltip={"Nether enter"} value={"Nether"}/>
                <TooltipLine tooltip={"Time spent on wall since last nether (excludes AFK)"} value={"Wall time"}/>
                <TooltipLine tooltip={"Time spent in overworlds since last nether"} value={"OW time"}/>
                <TooltipLine tooltip={"Previews entered since last nether"} value={"Played"}/>
                <TooltipLine tooltip={"Resets since last nether"} value={"Resets"}/>
                <TooltipLine tooltip={"Total reset count as of this enter"} value={"Total resets"}/>
            </tr>
            </thead>
            <tbody
                // One set of handlers serves the full history. Only real
                // pointer movement indicates intent: new rows appearing under
                // a stationary pointer must not start another page render.
                onPointerMove={(event) => {
                    if (event.pointerType === 'touch') return;
                    const href = rowHref(event.target);
                    if (href === hoveredHref.current) return;
                    cancelIntent();
                    hoveredHref.current = href;
                    if (href) intentTimer.current = setTimeout(() => prefetch(href), 100);
                }}
                onPointerLeave={cancelIntent}
                onFocusCapture={(event) => {
                    const href = rowHref(event.target);
                    if (href) prefetch(href);
                }}
                onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    const href = rowHref(event.target);
                    if (href) {
                        cancelIntent();
                        router.push(href);
                    }
                }}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    const href = rowHref(event.target);
                    if (href) {
                        event.preventDefault();
                        cancelIntent();
                        router.push(href);
                    }
                }}
            >
            {Object.keys(runs).map((runId) => {
                // @ts-ignore
                const run = runs[runId]
                return <tr key={run.runId} data-run={run.runId} role="link" tabIndex={0}>
                    <td>
                        {run.vodId && (<span className="liveIndicator"/>)}
                        <RelativeTimer start={run.time} compactBelow="md"/>
                    </td>
                    <td>{formatIfNotNull(run.nether)}</td>
                    <td>{formatIfNotNull(run.wallTime)}</td>
                    <td>{formatIfNotNull(run.playTime)}</td>
                    <td>{run.enters}</td>
                    <td>{run.resets ? numberWithCommas(run.resets) : ""}</td>
                    <td>{run.totalResets ? numberWithCommas(run.totalResets) : ""}</td>
                </tr>
            })}
            </tbody>
        </table>
    </div>
}
