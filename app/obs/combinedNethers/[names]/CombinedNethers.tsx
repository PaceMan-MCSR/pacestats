'use client'

import {useOverlayData} from '@/app/obs/useOverlayData';
import {overlayNameQuery} from '@/app/obs/sessionSubscription';

const refresh = 20

export interface CombinedNethersSettings {
    hours: number,
    hoursBetween: number,
    demo: boolean,
    color: string,
    font: string,
    start: number,
    maxTime: number
}

export default function CombinedNethers({names, settings, initialData}: {
    names: string,
    settings: CombinedNethersSettings,
    initialData?: any
}) {
    const { data } = useOverlayData(`/stats/api/getCombinedNethers/?names=${overlayNameQuery(names)}&hours=${settings.hours}&hoursBetween=${settings.hoursBetween}&start=${settings.start}&maxTime=${settings.maxTime}`,
        {demo: settings.demo, refreshInterval: refresh * 1000, initialData}
    )

    if(data && data.error) {
        return <main className="main obs sessionNethers">
            <div className="container">
                <h1>{data.error}</h1>
            </div>
        </main>
    }

    return (<main className={"main obs sessionNethers" + (settings.demo ? " demoBrowser" : "")}>
        <h1 style={{fontSize: "600%", color: `${settings.color}`, fontFamily: settings.font}}>{!data ? 0 : data.count}<br/>{!data ? "0:00" : data.avg}</h1>
    </main>)
}
