'use client'

import {useOverlayData} from '@/app/obs/useOverlayData';
import {overlayNameQuery} from '@/app/obs/sessionSubscription';
import {useOverlaySize} from '@/app/components/useOverlaySize';

const refresh = 30

export interface SessionSettings {
    hours: number,
    hoursBetween: number,
    showAvg: boolean,
    dynamic: boolean,
    demo: boolean,
    color: string,
    font: string
}

function StatLine({data, settings, split}: { data: any, settings: SessionSettings, split: string }) {
    const style = {
        color: settings.color,
        fontFamily: settings.font,
        display: "inline",
        position: "relative" as any, // idk typescript stuff
        top: 12,
        fontSize: "2.4em"
    }
    if(data === undefined || data.error){
        return <div className={"stat-line" + (settings.dynamic ? " col-auto" : "")}>
            <img className="icon" style={{width: 64, marginRight: 18}} src={"/stats/" + split + ".webp"}/>
            {settings.showAvg && <p style={style} className="split-name">0 0:00</p>}
            {!settings.showAvg && <p style={style} className="split-name">0</p>}
        </div>
    }
    if(data[split] == null){
        return null
    }
    return <div className={"stat-line" + (settings.dynamic ? " col-auto" : "")}>
        <img className="icon" style={{width: 64, marginRight: 18}} src={"/stats/" + split + ".webp"}/>
        {settings.showAvg && <p style={style} className="split-name">{data[split].count} {data[split].avg}</p>}
        {!settings.showAvg && <p style={style} className="split-name">{data[split].count}</p>}
    </div>
}

export default function Session({name, settings, setWidth, setHeight, initialData, initialDataAt}: {
    name: string,
    settings: SessionSettings,
    setWidth?: any,
    setHeight?: any,
    initialData?: any,
    initialDataAt?: number
}) {
    const { data } = useOverlayData(`/stats/api/getSessionStats/?name=${overlayNameQuery(name)}&hours=${settings.hours}&hoursBetween=${settings.hoursBetween}`,
        {demo: settings.demo, refreshInterval: refresh * 1000, initialData, initialDataAt}
    )

    const ref = useOverlaySize(setWidth, setHeight);

    if(data && data.error) {
        return <main className={"main sessionStats" + (settings.demo ? " demoBrowser" : "")}>
            <div className="container">
                <h1>{data.error}</h1>
            </div>
        </main>
    }

    return (<main ref={ref} className={"main sessionStats" + (settings.demo ? " demoBrowser" : "")}>
        <div className="row">
            <StatLine data={data} settings={settings} split="nether" />
            <StatLine data={data} settings={settings} split="bastion" />
            <StatLine data={data} settings={settings} split="fortress" />
            <StatLine data={data} settings={settings} split="first_portal" />
            <StatLine data={data} settings={settings} split="stronghold" />
            <StatLine data={data} settings={settings} split="end" />
            <StatLine data={data} settings={settings} split="finish" />
        </div>
    </main>)
}
