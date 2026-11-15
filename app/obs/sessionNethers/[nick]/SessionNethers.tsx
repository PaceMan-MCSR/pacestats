'use client'

import {useOverlayData} from '@/app/obs/useOverlayData';
import {overlayNameQuery} from '@/app/obs/sessionSubscription';
import {MAX_OVERLAY_NPH_DECIMALS, overlayInteger} from '@/app/obs/numericSettings';

const refresh = 60

export interface SessionNethersSettings {
    hours: number,
    hoursBetween: number,
    demo: boolean,
    color: string,
    font: string,
    nph: boolean,
    nphDp: number,
    liveOnly: boolean,
    decimals: number,
    nphRight: boolean
}

export default function SessionNethers({name, settings, initialData, initialDataAt}: {
    name: string,
    settings: SessionNethersSettings,
    initialData?: any,
    initialDataAt?: number
}) {

    const key = `/stats/api/getSessionNethers/?name=${overlayNameQuery(name)}&hours=${settings.hours}&hoursBetween=${settings.hoursBetween}&nph=${settings.nph}&liveOnly=${settings.liveOnly}&dp=${settings.decimals}`
    const { data } = useOverlayData(key,
        {demo: settings.demo, refreshInterval: refresh * 1000, initialData, initialDataAt}
    )

    if(data && data.error) {
        return <main className="main obs sessionNethers">
            <div className="container">
                <h1>{data.error}</h1>
            </div>
        </main>
    }

    let nph = ""
    const nphDp = overlayInteger(settings.nphDp, 0, 0, MAX_OVERLAY_NPH_DECIMALS);
    if(data) {
        const rnph = data.rnph || 0
        if (rnph === 0) {
            nph = (nphDp > 0 ? "0." + ("0".repeat(nphDp)) : "0")
        } else {
            nph = rnph.toFixed(nphDp)
        }
    }

    return (<main className={"main obs sessionNethers" + (settings.demo ? " demoBrowser" : "")}>
        <h1 style={{fontSize: "600%", color: `${settings.color}`, fontFamily: settings.font}}>
            {!data ? 0 : data.count}<br/>
        </h1>
        <h1 style={{fontSize: "600%", color: `${settings.color}`, fontFamily: settings.font}}>
            {!data ? "0:00" : data.avg}<br/>
        </h1>
        <h1 style={{fontSize: "600%", color: `${settings.color}`, fontFamily: settings.font, textAlign: settings.nphRight ? "right" : "left"}}>
            {settings.nph ? nph : ""}
        </h1>
    </main>)
}
