'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import {useRouter} from "next/navigation";
import {formatIfNotNull, numberWithCommas} from "@/app/utils";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";

function TooltipLine({tooltip, value}: {tooltip: string, value: string}) {
    return <OverlayTrigger overlay={
        <Tooltip className="nphTooltip">
            <p>{tooltip}</p>
        </Tooltip>
    } delay={{ show: 0, hide: 50 }}>
        <th>{value}</th>
    </OverlayTrigger>
}

export async function Nethers({runs}: { runs: {} }) {
    const router = useRouter()
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
            <tbody>
            {Object.keys(runs).map((runId, index) => {
                // @ts-ignore
                const run = runs[runId]
                return <tr key={index} onClick={() => {router.push(`/run/${run.runId}`)}}>
                    <td>
                        {run.vodId && (<span className="liveIndicator"/>)}
                        <span className="d-md-none">
                            <RelativeTimer start={run.time} small={true}/>
                        </span>
                        <span className="d-none d-md-inline">
                            <RelativeTimer start={run.time} small={false}/>
                        </span>
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