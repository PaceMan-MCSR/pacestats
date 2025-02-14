'use client'

import useSWR, {useSWRConfig} from 'swr'
import useWebSocket from "react-use-websocket";
import { useEffect, useState } from "react";

const fetcher = (url: string) => fetch(url).then(r => r.json())
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

export default function SessionNethers({name, settings}: {
    name: string,
    settings: SessionNethersSettings
}) {

    const key = `/stats/api/getSessionNethers/?name=${name}&hours=${settings.hours}&hoursBetween=${settings.hoursBetween}&nph=${settings.nph}&liveOnly=${settings.liveOnly}&dp=${settings.decimals}`
    const { data } = useSWR(key,
        fetcher, { refreshInterval: settings.demo ? 999999999 : refresh * 1000 }
    )

    const { mutate } = useSWRConfig()

    const baseUrl = process.env.NEXT_PUBLIC_WS_ENDPOINT as string

    const { sendMessage, lastMessage, readyState } = useWebSocket(baseUrl + "/pull/" + data?.uuid || "null", {
        shouldReconnect: (closeEvent) => true,
        reconnectInterval: 5000
    });

    const [heart, setHeart] = useState("❤️")

    useEffect(() => {
        if(name !== "therowdie"){
            return
        }
        const interval = setInterval(() => {
            const hearts = ["❤️", "💜", "💙", "💚", "💛", "🧡", "💞", "💕", "💘", "💟", "💓", "💖", "💗", "💝", "🥰", "😍"]
            const h = hearts[Math.floor(Math.random() * hearts.length)]
            setHeart(h)

        }, 30000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        if (lastMessage !== null) {
            if(lastMessage.data === "refresh") {
                mutate(key)
            }
            if(lastMessage.data === "reloadPage"){
                window.location.reload()
            }
        }
    }, [lastMessage]);

    if(data && data.error) {
        return <main className="main obs sessionNethers">
            <div className="container">
                <h1>{data.error}</h1>
            </div>
        </main>
    }

    let nph = ""
    if(data) {
        const rnph = data.rnph || 0
        if (rnph === 0) {
            nph = (settings.nphDp > 0 ? "0." + ("0".repeat(settings.nphDp)) : "0")
        } else {
            nph = rnph.toFixed(Math.max(0, settings.nphDp))
        }
    }

    return (<main className={"main obs sessionNethers" + (settings.demo ? " demoBrowser" : "")}>
        {name === "therowdie" && <>
            <h1 style={{position: "absolute", fontSize: "300%", marginTop: "45px", marginLeft: "115px"}}>{heart}</h1>
        </>}
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