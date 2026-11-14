'use client';

import {useEffect, useRef, useTransition} from "react";
import type {MouseEvent, ReactNode} from "react";
import {useRouter} from "next/navigation";
import {PrefetchKind} from "next/dist/client/components/router-reducer/router-reducer-types";
import type {LeaderboardModel} from "@/app/components/tables/leaderboardModel";

const BASE_PATH = "/stats";

/** One navigation/prefetch lifecycle serves every link in the selected tables. */
function BoardNavigation({children}: {children: ReactNode}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hovered = useRef<HTMLAnchorElement | null>(null);
    const pushed = useRef<HTMLAnchorElement | null>(null);
    const pendingLabel = useRef<HTMLElement | null>(null);
    const prefetched = useRef(new Map<string, number>());
    const cancel = () => {
        clearTimeout(timer.current);
        timer.current = undefined;
    };
    useEffect(() => () => clearTimeout(timer.current), []);
    useEffect(() => {
        if (!pending && pendingLabel.current) {
            pendingLabel.current.style.opacity = "1";
            pendingLabel.current = null;
        }
    }, [pending]);
    const findLink = (target: EventTarget) => target instanceof Element
        ? target.closest<HTMLAnchorElement>("a[data-board-link]") : null;
    const route = (link: HTMLAnchorElement) => link.pathname.slice(BASE_PATH.length) + link.search + link.hash;
    const prefetch = (link: HTMLAnchorElement) => {
        const href = route(link);
        const now = Date.now();
        if ((prefetched.current.get(href) ?? 0) > now) return;
        for (const [path, expiresAt] of prefetched.current) {
            if (expiresAt <= now) prefetched.current.delete(path);
        }
        if (prefetched.current.size >= 64) {
            const oldest = prefetched.current.keys().next().value;
            if (oldest !== undefined) prefetched.current.delete(oldest);
        }
        const expiresAt = now + 30_000;
        prefetched.current.set(href, expiresAt);
        router.prefetch(href, {
            kind: PrefetchKind.FULL,
            onInvalidate: () => {
                if (prefetched.current.get(href) === expiresAt) prefetched.current.delete(href);
            },
        });
    };
    const navigate = (event: MouseEvent, link: HTMLAnchorElement) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
            || link.hasAttribute("download") || (link.target && link.target !== "_self")) return false;
        cancel();
        if (pendingLabel.current) pendingLabel.current.style.opacity = "1";
        pendingLabel.current = link.querySelector<HTMLElement>(".playerName") ?? link;
        pendingLabel.current.style.opacity = "0.7";
        startTransition(() => router.push(route(link)));
        return true;
    };
    return <div className="row stats-row" aria-busy={pending}
        onPointerMove={event => {
            if (event.pointerType === "touch") return;
            const link = findLink(event.target);
            if (hovered.current === link) return;
            cancel();
            hovered.current = link;
            if (link) timer.current = setTimeout(() => prefetch(link), 100);
        }}
        onPointerLeave={() => { cancel(); hovered.current = null; }}
        onFocus={event => {
            const link = findLink(event.target);
            if (link && pushed.current !== link) { cancel(); prefetch(link); }
        }}
        onBlur={cancel}
        onTouchStart={event => {
            const link = findLink(event.target);
            if (link) { cancel(); prefetch(link); }
        }}
        onMouseDown={event => {
            const link = findLink(event.target);
            pushed.current = link && navigate(event, link) ? link : null;
        }}
        onClick={event => {
            const link = findLink(event.target);
            if (link && (pushed.current === link || navigate(event, link))) event.preventDefault();
            pushed.current = null;
        }}
    >{children}</div>;
}

export default function LeaderboardTableView({players, boards, showQty}: LeaderboardModel & {showQty: boolean}) {
    return <BoardNavigation>{boards.map(board => {
        const sample = board.kind === "average" || board.kind === "conversion";
        return <div key={board.id} className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
            <p className="tableHeader" title={board.help}>{board.title}</p>
            <table className="table table-dark caption-top">
                <thead><tr>
                    <th id={board.kind === "average" ? "num" : undefined}>#</th>
                    <th id="name">Name</th>
                    {sample && showQty && <th id={board.kind === "average" ? "qty" : undefined}>Qty</th>}
                    <th id={board.kind === "average" ? "avg" : undefined}>{board.kind === "quantity" ? "Qty" : board.kind === "average" ? "Avg" : board.kind === "fastest" ? "Time" : "Rate"}</th>
                </tr></thead>
                <tbody>{board.rows.map((row, index) => {
                    const player = players[row.player];
                    const label = sample && showQty && player.name.length > 12 ? player.name.slice(0, 12) : player.name;
                    return <tr key={`${row.player}-${row.runId ?? index}`}>
                        <td className="col-1"><p>{index + 1}</p></td>
                        <td className="col-10">
                            <a className="boardLink" href={`${BASE_PATH}/player/${player.name}/`} data-board-link="">
                                <p className="playerName" style={{opacity: 1, color: player.color}}>
                                    <img className="avatar" src={`https://mc-api.io/render/FACE/${player.uuid}?size=8`}
                                        alt={player.name} loading="lazy" decoding="async" fetchPriority={index >= 3 ? "low" : undefined} width={24} height={24}/>
                                    {label}
                                </p>
                            </a>
                        </td>
                        {sample && showQty && <td className="col-1" style={{textAlign: "right"}}>
                            <p style={board.kind === "average" ? {color: row.color} : undefined}>{row.quantity}</p>
                        </td>}
                        <td className="col-1" title={sample ? String(row.quantity) : row.hint} style={board.kind === "quantity" ? {textAlign: "right"} : undefined}>
                            {board.kind === "fastest" && row.runId != null
                                ? <a href={`${BASE_PATH}/run/${row.runId}/`} data-board-link="" style={{marginLeft: 5, textDecoration: "none"}}><p>{row.value}</p></a>
                                : <p style={sample ? {color: row.color} : undefined}>{row.value}</p>}
                        </td>
                    </tr>;
                })}</tbody>
            </table>
        </div>;
    })}</BoardNavigation>;
}
