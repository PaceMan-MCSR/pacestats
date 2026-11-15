import {initialOverlayData} from '@/app/obs/initialData.server';

import '../../../styles/obs.css'

import SessionNethers from "@/app/obs/sessionNethers/[nick]/SessionNethers";

export default async function Page(
    props: {
        params: Promise<{ nick: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const [searchParams, params] = await Promise.all([props.searchParams, props.params]);
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
    const initialData = await initialOverlayData('nethers', nick, {hours, hoursBetween, nph, liveOnly, dp}, demo);
    return <SessionNethers name={nick} initialData={initialData} settings={{
            hours: hours, hoursBetween: hoursBetween, color: `#${color}`, demo: demo, font: font,
            nph: nph, liveOnly: liveOnly, decimals: dp, nphDp: nphDp, nphRight: nphRight
        }}/>
}
