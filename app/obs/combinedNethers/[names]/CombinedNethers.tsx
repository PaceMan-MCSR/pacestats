'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())
const refresh = 20

export interface CombinedNethersSettings {
    hours: number,
    hoursBetween: number,
    demo: boolean,
    color: string,
    font: string,
    start: number
}

export default function CombinedNethers({names, settings}: {
    names: string,
    settings: CombinedNethersSettings
}) {
    const { data } = useSWR(`/stats/api/getCombinedNethers/?names=${names}&hours=${settings.hours}&hoursBetween=${settings.hoursBetween}&start=${settings.start}`,
        fetcher, { refreshInterval: settings.demo ? 999999999 : refresh * 1000 }
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