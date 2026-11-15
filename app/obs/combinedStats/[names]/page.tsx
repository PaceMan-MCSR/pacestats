import {initialOverlayData} from '@/app/obs/initialData.server';

import '../../../styles/obs.css'
import CombinedStats from "@/app/obs/combinedStats/[names]/CombinedStats";

export default async function Page(
    props: {
        params: Promise<{ names: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const [searchParams, params] = await Promise.all([props.searchParams, props.params]);
    let hours: number = parseInt(searchParams["hours"] || "24")
    let showAvg: boolean = searchParams["showAvg"] === "true"
    let dynamic: boolean = searchParams["dynamic"] === "true"
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

    const initialData = await initialOverlayData('combinedStats', params.names, {hours, hoursBetween, start}, demo);
    return <div>
        <CombinedStats names={params.names} initialData={initialData?.data} initialDataAt={initialData?.at} settings={{
        hours: hours, hoursBetween: hoursBetween, color: `#${color}`,
        demo: demo, showAvg: showAvg, dynamic: dynamic, font: font, start: start
        }}/>
    </div>
}
