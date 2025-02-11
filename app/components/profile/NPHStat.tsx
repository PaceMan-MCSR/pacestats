'use client'

import { formatTime, getDarkerColor, numberWithCommas } from "@/app/utils";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import Link from "next/link";
import { useContext, useState } from "react";
import { UserColoursContext } from "@/app/contexts";
import Box from "@mui/material/Box";

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
    const colours = useContext(UserColoursContext)
    if(data === null) {
        return <Box className="stat nph mb-4" sx={colours.isCustom ? {
            backgroundColor: `#${colours?.fg} !important`,
            borderColor: `#${getDarkerColor(colours?.fg, 0.6)} !important`,
            '& p, h4': {
                ...colours.fgText
            },
        } : {}}>
            <h4 className="statHeader" style={{marginBottom: 10, userSelect: "none"}}>
                Resetting
            </h4>
            <p style={{lineHeight: 1.4}}>{nick} does not have any enters with the latest version of PaceMan Tracker.</p>
        </Box>
    }
    const [focus, setFocus] = useState(false);

    return <Box className="stat nph mb-4" onClick={() => {setFocus(!focus)}} sx={colours.isCustom ? {
        backgroundColor: `#${colours?.fg} !important`,
        borderColor: `#${getDarkerColor(colours?.fg, 0.6)} !important`,
        '& p, h4': {
            ...colours.fgText
        },
        '& h5': {
            color: `#${colours.name}`,
            filter: `drop-shadow(0 0 1px #000) drop-shadow(0 0 1px #000)`
        }
    } : {}}>
        {!focus && (
            <h4 className="statHeader" style={{marginBottom: 10, userSelect: "none"}}>
                Resetting
            </h4>
        )}
        {!focus && (
            <Box className="openHistory" sx={colours.isCustom ? {
                '& button': {
                    backgroundColor: `#${getDarkerColor(colours.fg, 0.9)}`,
                    ...colours.bgText
                },
                '& button:hover': {
                    backgroundColor: `#${getDarkerColor(colours.fg, 0.8)}`,
                    ...colours.fgText
                }
            } : {}}>
                <Link href={`/player/${nick}/nethers`}>
                    <button className="btn btn-dark">Debug</button>
                </Link>
            </Box>
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
    </Box>
}