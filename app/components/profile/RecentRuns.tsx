'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import { formatIfNotNull, getDarkerColor } from "@/app/utils";
import {useRouter} from "next/navigation";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import Box from "@mui/material/Box";

export function RecentRuns({runs}: { runs: {} }) {
    const router = useRouter()
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
        <Box sx={colours.isCustom ? {
            '& .table tr:hover td': {
                backgroundColor: `#${colours?.bg} !important`,
            },
            '& .table tr': {
                backgroundColor: `#${colours?.bg} !important`,
                borderColor: `#${getDarkerColor(colours?.fg, 0.7)}`
            },
            '& .table': {
                "--bs-table-bg": `#${colours?.fg}`,
                "--bs-table-color": `${(colours?.fgText as {color: string}).color}`,
            }
        } : {}}>
            <table className="table table-dark table-bordered table-sm" style={colours.isCustom ? {
            } : {}}>
                <thead>
                <tr className="paceHeader">
                    <th>Time</th>
                    <th>
                        <img src="/stats/nether.webp" alt="Nether" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">Nether</p>
                    </th>
                    <th>
                        <img src="/stats/bastion.webp" alt="Bastion" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">Bastion</p>
                    </th>
                    <th>
                        <img src="/stats/fortress.webp" alt="Fortress" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">Fortress</p>
                    </th>
                    <th>
                        <img src="/stats/first_portal.webp" alt="First Portal" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">First Portal</p>
                    </th>
                    <th>
                        <img src="/stats/stronghold.webp" alt="Stronghold" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">Eye Spy</p>
                    </th>
                    <th>
                        <img src="/stats/end.webp" alt="End" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">End</p>
                    </th>
                    <th>
                        <img src="/stats/finish.webp" alt="Finish" className="icon d-md-none"/>
                        <p className="d-none d-md-inline">Finish</p>
                    </th>
                </tr>
                </thead>
                <tbody>
                {Object.keys(runs).map((runId, index) => {
                    // @ts-ignore
                    const run = runs[runId]
                    if(run.vodId === null){
                        return <tr key={index} onClick={() => {router.push(`/run/${run.id}`)}}>
                            <td>
                                <span className="d-sm-none">
                                    <RelativeTimer start={run.lastUpdated / 1000} small={true}/>
                                </span>
                                <span className="d-none d-sm-block">
                                    <RelativeTimer start={run.lastUpdated / 1000} small={false}/>
                                </span>
                            </td>
                            <td>{formatIfNotNull(run.nether)}</td>
                            <td>{formatIfNotNull(run.bastion)}</td>
                            <td>{formatIfNotNull(run.fortress)}</td>
                            <td>{formatIfNotNull(run.first_portal)}</td>
                            <td>{formatIfNotNull(run.stronghold)}</td>
                            <td>{formatIfNotNull(run.end)}</td>
                            <td>{formatIfNotNull(run.finish)}</td>
                        </tr>
                    } else {
                        return <tr key={index} onClick={() => {router.push(`/run/${run.id}`)}}>
                            <td>
                                <span className="liveIndicator"/>
                                <span className="d-sm-none">
                                    <RelativeTimer start={run.lastUpdated / 1000} small={true}/>
                                </span>
                                <span className="d-none d-sm-inline">
                                    <RelativeTimer start={run.lastUpdated / 1000} small={false}/>
                                </span>
                            </td>
                            <td>{formatIfNotNull(run.nether)}</td>
                            <td>{formatIfNotNull(run.bastion)}</td>
                            <td>{formatIfNotNull(run.fortress)}</td>
                            <td>{formatIfNotNull(run.first_portal)}</td>
                            <td>{formatIfNotNull(run.stronghold)}</td>
                            <td>{formatIfNotNull(run.end)}</td>
                            <td>{formatIfNotNull(run.finish)}</td>
                        </tr>
                    }
                })}
                </tbody>
            </table>
        </Box>
    </div>
}