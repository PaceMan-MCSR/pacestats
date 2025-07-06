'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import {formatIfNotNull} from "@/app/utils";

export function AARecentRuns({runs}: { runs: {} }) {
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
                    <img src="/stats/stronghold.webp" alt="Stronghold" className="icon d-md-none"/>
                    <p className="d-none d-md-inline">Eye Spy</p>
                </th>
                <th>
                    <img src="/stats/end.webp" alt="End" className="icon d-md-none"/>
                    <p className="d-none d-md-inline">End</p>
                </th>
                <th>
                    <p className="d-inline">Elytra</p>
                </th>
                <th>
                    <p className="d-inline">End Exit</p>
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
                if(run.twitch === null){
                    return <tr key={index}>
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
                        <td>{formatIfNotNull(run.stronghold)}</td>
                        <td>{formatIfNotNull(run.end)}</td>
                        <td>{formatIfNotNull(run.elytra)}</td>
                        <td>{formatIfNotNull(run.credits)}</td>
                        <td>{formatIfNotNull(run.finish)}</td>
                    </tr>
                } else {
                    return <tr key={index}>
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
    </div>
}