import {initialOverlayData} from '@/app/obs/initialData.server';

import '../../../styles/obs.css'
import CombinedNethers from "@/app/obs/combinedNethers/[names]/CombinedNethers";

export default async function Page(
    props: {
        params: Promise<{ names: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const [searchParams, params] = await Promise.all([props.searchParams, props.params]);
    let hours: number = parseInt(searchParams["hours"] || "24")
    let demo: boolean = searchParams["demo"] === "true"
    let font: string = searchParams["font"] || "Minecraft"
    let color = searchParams["color"] || "000000"
    let start = parseInt(searchParams["start"] || "0")
    let maxTime = parseInt(searchParams["maxTime"] || "99999999")
    if (isNaN(hours)) {
        hours = 24
    }
    let hoursBetween = parseInt(searchParams["hoursBetween"] || "2")
    if (isNaN(hoursBetween)) {
        hoursBetween = 2
    }

    const initialData = await initialOverlayData('combinedNethers', params.names, {hours, hoursBetween, start, maxTime}, demo);
    return <div>
        <CombinedNethers names={params.names} initialData={initialData?.data} initialDataAt={initialData?.at} settings={{
        hours: hours, hoursBetween: hoursBetween, color: `#${color}`,
        demo: demo, font: font, start: start, maxTime
        }}/>
    </div>
}
