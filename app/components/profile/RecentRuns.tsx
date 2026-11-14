'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import type {RecentRunRow} from "./recentRunPresentation";
import RunRow from "@/app/components/profile/RunRow";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import { colourVars, customClass } from "@/app/components/customColours";

export function RecentRuns({runs}: { runs: RecentRunRow[] }) {
    const colours = useContext(UserColoursContext)
    return <div className="recentRuns">
        <h4 className="runsHeader" style={colours.isCustom ? {
            color: `#${colours.name}`,
            filter: `drop-shadow(0px 0px 2px #000000)`
        } : {}}>Recent paces</h4>
        <div style={{textAlign: "center"}}>
            <h6 style={colours.isCustom ? {
                color: `#${colours.name}`,
                filter: `drop-shadow(0px 0px 2px #000000)`
            } : {}}>Click on a row to view run info</h6>
        </div>
        <div className="liveDescription" style={colours?.bgText}>
            <span className="liveIndicator"/>= Live
        </div>
        <div className={customClass(colours, "ccRecentRuns")} style={colourVars(colours)}>
            <table className="table table-dark table-bordered table-sm" style={colours.isCustom ? {
            } : {}}>
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
                        <img src="/stats/first_portal.webp" alt="First Portal" className="icon d-md-none" loading="lazy"/>
                        <p className="d-none d-md-inline">First Portal</p>
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
                        <img src="/stats/finish.webp" alt="Finish" className="icon d-md-none" loading="lazy"/>
                        <p className="d-none d-md-inline">Finish</p>
                    </th>
                </tr>
                </thead>
                <tbody>
                {runs.map(run => <RunRow key={run.id} href={`/run/${run.id}`}>
                    <td>
                        {run.live && <span className="liveIndicator"/>}
                        <RelativeTimer start={run.time} compactBelow="sm"/>
                    </td>
                    {run.cells.map((cell, index) => <td key={index}>{cell}</td>)}
                </RunRow>)}
                </tbody>
            </table>
        </div>
    </div>
}