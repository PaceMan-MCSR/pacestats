'use client'

import '../../../styles/obs.css'
import Session from "@/app/obs/session/[nick]/Session";
import CombinedNethers from "@/app/obs/combinedNethers/[names]/CombinedNethers";

export default function Page({params, searchParams}: {
    params: { names: string },
    searchParams: { [key: string]: string | undefined }
}) {
    let hours: number = parseInt(searchParams["hours"] || "24")
    let demo: boolean = searchParams["demo"] === "true"
    let font: string = searchParams["font"] || "Minecraft"
    let color = searchParams["color"] || "000000"
    let start = parseInt(searchParams["start"] || "0")
    if (isNaN(hours)) {
        hours = 24
    }
    let hoursBetween = parseInt(searchParams["hoursBetween"] || "2")
    if (isNaN(hoursBetween)) {
        hoursBetween = 2
    }

    return <div>
        <CombinedNethers names={params.names} settings={{
        hours: hours, hoursBetween: hoursBetween, color: `#${color}`,
        demo: demo, font: font, start: start
        }}/>
    </div>
}