'use client'

import {formatTime, numberWithCommas} from "@/app/utils";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import Link from "next/link";
import {useState} from "react";

function TooltipLine({tooltip, value}: {tooltip: string, value: string}) {
    return <OverlayTrigger overlay={
        <Tooltip className="nphTooltip">
            <p>{tooltip}</p>
        </Tooltip>
    } delay={{ show: 200, hide: 50 }}>
        <p style={{width: "fit-content"}}>{value}</p>
    </OverlayTrigger>
}

export function NPHStat({nick, headUrl, days, data}: {
    nick?: string,
    headUrl?: string,
    days?: number,
    data: null | {
        rtanph: number,
        rnph: number,
        lnph: number,
        count: number,
        avg: number,
        playtime: number,
        walltime: number,
        resets: number,
        totalResets: number,
        seedsPlayed: number,
        rpe: number
    }
}) {
    if(data === null) {
        return <div className="stat nph mb-4">
            <h4 className="statHeader" style={{marginBottom: 10, userSelect: "none"}}>
                Resetting
            </h4>
            <p style={{lineHeight: 1.4}}>{nick} does not have any enters with the latest version of PaceMan Tracker.</p>
        </div>
    }
    const [focus, setFocus] = useState(false);

    return <div className="stat nph mb-4" onClick={() => {setFocus(!focus)}}>
        {!focus && (
            <h4 className="statHeader" style={{marginBottom: 10, userSelect: "none"}}>
                Resetting
            </h4>
        )}
        {!focus && (
            <div className="openHistory">
                <Link href={`/player/${nick}/nethers`}>
                    <button className="btn btn-dark">Debug</button>
                </Link>
            </div>
        )}
        {focus && (
            <div>
                <h4 className="statHeader" style={{marginBottom: 8, userSelect: "none"}}>
                    Resetting <div><p>{days === 9999 ? "Lifetime" : days + "d"}</p></div>
                </h4>
                <h5 style={{marginBottom: 12, userSelect: "none"}}>
                    <img className="titleHead" style={{width: 24, marginLeft: 0}} src={headUrl} alt={nick}/>
                    {nick}
                </h5>
            </div>
        )}

        <TooltipLine
            tooltip={"Enters with the NPH tracker active"}
            value={`Nethers: ${data.count}`}/>
        <TooltipLine
            tooltip={"Average nether enter of tracked runs"}
            value={`Average: ${formatTime(data.avg)}`}/>
        <TooltipLine
            tooltip={"Includes wall time and overworlds, but excludes wall AFK and nether"}
            value={`RNPH: ${data.rnph}`}/>
        <TooltipLine
            tooltip={"Only includes overworld time, not used often"}
            value={`LNPH: ${data.lnph}`}/>
        <TooltipLine
            tooltip={"Average resets per nether"}
            value={`Resets per enter: ${Math.round(data.rpe)}`}/>
        <TooltipLine
            tooltip={"Requires OBS Lua script. Total reset count is from Julti (or other macros)"}
            value={`Resets: ${numberWithCommas(data.resets)}, total: ${numberWithCommas(data.totalResets)}`}/>
    </div>
}