'use client'

import {useState} from "react";
import RelativeTimer from "@/app/components/profile/RelativeTimer";
import {formatIfNotNull} from "@/app/utils";

const PAGE_SIZE = 100;

type AARun = {
    id: number;
    twitch: string | null;
    lastUpdated: number;
    nether: number | null;
    bastion: number | null;
    fortress: number | null;
    stronghold: number | null;
    end: number | null;
    elytra: number | null;
    credits: number | null;
    finish: number | null;
};

type AARunsPage = {
    rows: AARun[];
    nextCursor: number | null;
    hasMore: boolean;
};

/**
 * Some players have thousands of AA runs. The server renders the first page
 * and the rest load on demand, instead of shipping every run in the HTML.
 */
export default function AARecentRuns({uuid, initialPage}: { uuid: string, initialPage: AARunsPage }) {
    const [runs, setRuns] = useState<AARun[]>(initialPage.rows);
    const [nextCursor, setNextCursor] = useState<number | null>(initialPage.nextCursor);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);

    const loadMore = async () => {
        if (loading || nextCursor === null) return;
        setLoading(true);
        setFailed(false);
        try {
            const params = new URLSearchParams({
                uuid,
                beforeId: String(nextCursor),
                limit: String(PAGE_SIZE),
            });
            const response = await fetch(`/stats/api/getAAPlayerRuns/?${params}`);
            if (!response.ok) throw new Error(`Unable to load AA runs (${response.status})`);
            const page = await response.json() as AARunsPage;
            setRuns((current) => [...current, ...page.rows]);
            setNextCursor(page.hasMore ? page.nextCursor : null);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    return <div className="recentRunsFull">
        <div className="liveDescription">
            <span className="liveIndicator"/>= Live
        </div>
        <table className="table table-dark table-bordered table-sm noHover">
            <thead>
            <tr className="paceHeader">
                <th>Time</th>
                <th>
                    <img src="/stats/nether.webp" alt="Nether" className="icon d-md-none" loading="lazy"/>
                    <p className="d-none d-md-inline">Nether</p>
                </th>
                <th>
                    <img src="/stats/bastion.webp" alt="Bastion" className="icon d-md-none" loading="lazy"/>
                    <p className="d-none d-md-inline">Bastion</p>
                </th>
                <th>
                    <img src="/stats/fortress.webp" alt="Fortress" className="icon d-md-none" loading="lazy"/>
                    <p className="d-none d-md-inline">Fortress</p>
                </th>
                <th>
                    <img src="/stats/stronghold.webp" alt="Stronghold" className="icon d-md-none" loading="lazy"/>
                    <p className="d-none d-md-inline">Eye Spy</p>
                </th>
                <th>
                    <img src="/stats/end.webp" alt="End" className="icon d-md-none" loading="lazy"/>
                    <p className="d-none d-md-inline">End</p>
                </th>
                <th>
                    <p className="d-inline">Elytra</p>
                </th>
                <th>
                    <p className="d-inline">End Exit</p>
                </th>
                <th>
                    <img src="/stats/finish.webp" alt="Finish" className="icon d-md-none" loading="lazy"/>
                    <p className="d-none d-md-inline">Finish</p>
                </th>
            </tr>
            </thead>
            <tbody>
            {runs.map((run) => {
                if(run.twitch === null){
                    return <tr key={run.id}>
                        <td>
                            <span className="d-sm-none">
                                <RelativeTimer start={Number(run.lastUpdated) / 1000} small={true}/>
                            </span>
                            <span className="d-none d-sm-block">
                                <RelativeTimer start={Number(run.lastUpdated) / 1000} small={false}/>
                            </span>
                        </td>
                        <td>{formatIfNotNull(run.nether)}</td>
                        <td>{formatIfNotNull(run.bastion)}</td>
                        <td>{formatIfNotNull(run.fortress)}</td>
                        <td>{formatIfNotNull(run.stronghold)}</td>
                        <td>{formatIfNotNull(run.end)}</td>
                        <td>{formatIfNotNull(run.elytra)}</td>
                        <td>{formatIfNotNull(run.credits)}</td>
                        <td>{formatIfNotNull(run.finish)}</td>
                    </tr>
                } else {
                    return <tr key={run.id}>
                        <td>
                            <span className="liveIndicator"/>
                            <span className="d-sm-none">
                                <RelativeTimer start={Number(run.lastUpdated) / 1000} small={true}/>
                            </span>
                            <span className="d-none d-sm-inline">
                                <RelativeTimer start={Number(run.lastUpdated) / 1000} small={false}/>
                            </span>
                        </td>
                        <td>{formatIfNotNull(run.nether)}</td>
                        <td>{formatIfNotNull(run.bastion)}</td>
                        <td>{formatIfNotNull(run.fortress)}</td>
                        <td>{formatIfNotNull(run.stronghold)}</td>
                        <td>{formatIfNotNull(run.end)}</td>
                        <td>{formatIfNotNull(run.elytra)}</td>
                        <td>{formatIfNotNull(run.credits)}</td>
                        <td>{formatIfNotNull(run.finish)}</td>
                    </tr>
                }
            })}
            </tbody>
        </table>
        {nextCursor !== null && <div style={{textAlign: "center"}} className="mb-4">
            <button className="btn btn-dark" onClick={loadMore} disabled={loading}>
                {loading ? "Loading..." : "Load more runs"}
            </button>
            {failed && <p className="mt-2">Could not load more runs. Try again.</p>}
        </div>}
    </div>
}
