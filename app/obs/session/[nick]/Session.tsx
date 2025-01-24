'use client'

import useSWR from 'swr'
import {useEffect, useRef} from "react";

const fetcher = (url: string) => fetch(url).then(r => r.json())
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

export default function Session({name, settings, setWidth, setHeight}: {
    name: string,
    settings: SessionSettings,
    setWidth?: any,
    setHeight?: any
}) {
    const { data } = useSWR(`/stats/api/getSessionStats/?name=${name}&hours=${settings.hours}&hoursBetween=${settings.hoursBetween}`,
        fetcher, { refreshInterval: settings.demo ? 999999999 : refresh * 1000 }
    )

    const ref = useRef(null)

    useEffect(() => {
        const timer = setInterval(() => {
            if(ref.current && setWidth && setHeight){
                // @ts-ignore
                setWidth(ref.current.clientWidth - 20)
                // @ts-ignore
                setHeight(ref.current.clientHeight)
            }
        }, 20)
        return () => {
            clearInterval(timer)
        }
    }, [])

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