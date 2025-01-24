'use client'

import '../../../styles/obs.css'

import SessionNethers from "@/app/obs/sessionNethers/[nick]/SessionNethers";

export default function Page({params, searchParams}: {
    params: { nick: string },
    searchParams: { [key: string]: string | undefined }
}) {
    let hours: number = parseInt(searchParams["hours"] || "24")
    if (isNaN(hours)) {
        hours = 24
    }
    let hoursBetween = parseInt(searchParams["hoursBetween"] || "2")
    if (isNaN(hoursBetween)) {
        hoursBetween = 2
    }
    let demo: boolean = searchParams["demo"] === "true"
    let color: string = searchParams["color"] || "000000"
    let font : string = searchParams["font"] || "Minecraft"
    let nph : boolean = searchParams["nph"] === "true"
    let liveOnly : boolean = searchParams["liveOnly"] === "true"
    let dp : number = parseInt(searchParams["dp"] || "0")
    let nphDp : number = parseInt(searchParams["nphDp"] || "0")
    let nphRight : boolean = searchParams["nphRight"] === "true"
    let nick = params.nick
    return <SessionNethers name={nick} settings={{
            hours: hours, hoursBetween: hoursBetween, color: `#${color}`, demo: demo, font: font,
            nph: nph, liveOnly: liveOnly, decimals: dp, nphDp: nphDp, nphRight: nphRight
        }}/>
}