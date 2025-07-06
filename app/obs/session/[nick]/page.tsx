'use client';
import { use } from "react";

import '../../../styles/obs.css'
import Session from "@/app/obs/session/[nick]/Session";

export default function Page(
    props: {
        params: Promise<{ nick: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const searchParams = use(props.searchParams);
    const params = use(props.params);
    let hours: number = parseInt(searchParams["hours"] || "24")
    let showAvg: boolean = searchParams["showAvg"] === "true"
    let dynamic: boolean = searchParams["dynamic"] === "true"
    let demo: boolean = searchParams["demo"] === "true"
    let font: string = searchParams["font"] || "Minecraft"
    let color = searchParams["color"] || "000000"
    if (isNaN(hours)) {
        hours = 24
    }
    let hoursBetween = parseInt(searchParams["hoursBetween"] || "2")
    if (isNaN(hoursBetween)) {
        hoursBetween = 2
    }
    let nick = params.nick

    return <div>
        <Session name={nick} settings={{
        hours: hours, hoursBetween: hoursBetween, color: `#${color}`,
        demo: demo, showAvg: showAvg, dynamic: dynamic, font: font
        }}/>
    </div>
}