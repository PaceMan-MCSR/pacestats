'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import type {RecentRunRow} from "./recentRunPresentation";

export function AARecentRuns({runs}: { runs: RecentRunRow[] }) {
    return <div className="recentRuns">
        <h4 className="runsHeader">Recent AA paces</h4>
        <div style={{textAlign: "center"}}>
            <h6>Click on a row to view run info</h6>
        </div>
        <div className="liveDescription">
            <span className="liveIndicator"/>= Live
        </div>
        <table className="table table-dark table-bordered table-sm noHover">
            <thead>
            <tr className="paceHeader">
                <th style={{width: "125px"}}>Time</th>
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
            {runs.map(run => <tr key={run.id}>
                <td>
                    {run.live && <span className="liveIndicator"/>}
                    <RelativeTimer start={run.time} compactBelow="sm"/>
                </td>
                {run.cells.map((cell, index) => <td key={index}>{cell}</td>)}
            </tr>)}
            </tbody>
        </table>
    </div>
}