'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import {formatIfNotNull, formatVodLink} from "@/app/utils";
import {useRouter} from "next/navigation";
export default function AARecentRuns({runs}: { runs: {} }) {
    const router = useRouter()
    return <div className="recentRunsFull">
        <div className="liveDescription">
            <span className="liveIndicator"/>= Live
        </div>
        <table className="table table-dark table-bordered table-sm noHover">
            <thead>
            <tr className="paceHeader">
                <th>Time</th>
                <th>
                    <img src="/stats/nether.webp" alt="Nether" className="icon d-md-none"/>
                    <p className="d-none d-md-inline">Nether</p>
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
                if(run.vodId === null){
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
                        <td>{formatIfNotNull(run.first_portal)}</td>
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
                        <td>{formatIfNotNull(run.first_portal)}</td>
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