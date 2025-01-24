'use client'

import useSWR from 'swr'
import {useEffect, useState} from "react";
import {useRunStore} from "@/app/run/[worldid]/RunStore";
import {getEventTime, getLastSplit} from "@/app/utils";

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function RunData({params}: {
    params: { worldid: string }
}) {
    const [isRunLive, setIsRunLive] = useState(false)

    const getWorldInterval = () => {
        return 9999999999
    }

    const getArsInterval = () => {
        return isRunLive ? 3000 : 9999999999
    }

    const worldId = params.worldid
    const { data } = useSWR(`/stats/api/getWorld/?worldId=${worldId}`,
        fetcher, { refreshInterval: getWorldInterval }
    )

    const { data: ars } = useSWR(`https://paceman.gg/api/ars/liveruns`,
        fetcher, { refreshInterval: getArsInterval }
    )

    useEffect(() => {
        if(!isRunLive || useRunStore.getState().data === undefined) {
            if(data === null){
                useRunStore.setState({
                    data: null,
                })
            } else {
                useRunStore.setState({
                    data: data?.data,
                    isLive: data?.isLive
                })
                console.log("Setting live status from worldId: " + (!!data?.isLive))
            }
        }
        if(data === null){
            useRunStore.setState({
                isLoading: false
            })
        }
        if(data){
            window.history.replaceState(null, "", `/stats/run/${data.data.id}/`)
        }
    }, [data])

    useEffect(() => {
        if(!ars || !data || !data.data) return
        let run = ars.find((run: any) => data.data.worldId === run.worldId)
        if(run){
            const newData = {
                ...data.data,
                nether: getEventTime(run, "rsg.enter_nether", false),
                bastion: getEventTime(run, "rsg.enter_bastion", false),
                fortress: getEventTime(run, "rsg.enter_fortress", false),
                first_portal: getEventTime(run, "rsg.first_portal", false),
                stronghold: getEventTime(run, "rsg.enter_stronghold", false),
                end: getEventTime(run, "rsg.enter_end", false),
                finish: getEventTime(run, "rsg.finish", false),

                netherRta: getEventTime(run, "rsg.enter_nether", true),
                bastionRta: getEventTime(run, "rsg.enter_bastion", true),
                fortressRta: getEventTime(run, "rsg.enter_fortress", true),
                first_portalRta: getEventTime(run, "rsg.first_portal", true),
                strongholdRta: getEventTime(run, "rsg.enter_stronghold", true),
                endRta: getEventTime(run, "rsg.enter_end", true),
                finishRta: getEventTime(run, "rsg.finish", true),
            }

            useRunStore.setState({
                data: newData
            })

            const last = getLastSplit(newData, false)
            document.title = `${last.full} by ${newData.nickname}`;
        }
    }, [ars])

    useEffect(() => {
        if(!data){
            return
        }
        let live = (ars && !!ars.find((run: any) => data.data.worldId === run.worldId && !run.isCheated && !run.isHidden))
        if(isRunLive && !live){
            console.log("Scheduling death")
            setTimeout(() => {
                setIsRunLive(live)
                useRunStore.setState({
                    isLive: live
                })
                console.log("Death happened at", Date.now())
            }, 5000)
            useRunStore.setState({
                dying: true
            })
        } else {
            setIsRunLive(live)
            useRunStore.setState({
                isLoading: false,
                isLive: live
            })
        }
    }, [ars, data])

    return null;
}