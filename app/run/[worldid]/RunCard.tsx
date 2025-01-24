'use client'

import {formatTime, getLastSplit} from "@/app/utils";
import { mcFont } from "@/app/styles/fonts";
import {useRunStore} from "@/app/run/[worldid]/RunStore";
import Image from "next/image";

function CardLine({data, split}: { data: any, split: string }) {
    if(data[split] == null){
        return null
    }
    const splitOffset = Math.floor(data.vodOffset + (data[split + "Rta"] / 1000) + 2)
    const embed = useRunStore(state => state.vodEmbed)
    if(data.vodId === null || embed === undefined) {
        return <div className="card-line">
            <Image priority={true} className="icon" width={40} height={40} src={"/stats/" + split + ".webp"} alt={split}/>
            <p style={mcFont.style} className="split-name">{formatTime(data[split])}</p>
        </div>
    } else {
        return <div className="card-line">
            <Image priority={true} className="icon" width={40} height={40} src={"/stats/" + split + ".webp"} alt={split}/>
            <p style={mcFont.style} className="split-name has-vod" onClick={() => {
                embed.seek(splitOffset)
            }}>{formatTime(data[split])}</p>
        </div>
    }
}

export default function RunCard() {
    const data = useRunStore(state => state.data)
    const vodEmbed = useRunStore(state => state.vodEmbed)


    const last = getLastSplit(data, false)
    const headUrl = `https://mc-heads.net/avatar/${data.uuid}/8`

    const start = Math.floor(data.vodOffset + 2)
    const end = Math.floor(data.vodOffset + (data[last.split+ "Rta"] / 1000) + 2)

    const seek = (time: number) => {
        const embed = useRunStore.getState().vodEmbed
        if(embed !== undefined) {
            embed.seek(time)
        }
    }

    const hasVodEmbed = vodEmbed !== undefined && data.vodId !== null

    return (
        <div className="run-card">
            <div className="card-bg" style={{
                background: `linear-gradient(rgba(0, 0, 0, 0.2), rgba(0, 0, 0, 0.2)), url('/stats/backgrounds/${last.split}.webp')`
            }}/>
            <div className="staticWrapper">
                {hasVodEmbed && (
                    <div>
                        <div className="startButton" onClick={() => {seek(start)}}/>
                        <div className="endButton" onClick={() => {seek(end)}}/>
                    </div>
                )}
                <a href={`/stats/player/${data.nickname}/`} className="nameWrapper">
                    <Image priority={true} className="cardHead" width={40} height={40} src={headUrl} alt={data.nickname}/>
                    <p style={mcFont.style} className="playerName">{data.nickname}</p>
                </a>
                <p style={mcFont.style} className="runDate">{new Date((data.realUpdate || data.insertTime) * 1000).toLocaleDateString("en-US")}</p>
                <p style={mcFont.style} className="secretId">{data.id}</p>
            </div>
            <div className="card-line-wrapper">
                <CardLine data={data} split="nether" />
                {data.bastion != null && data.bastion < data.fortress && <CardLine data={data} split="bastion" />}
                {data.fortress != null && data.fortress < data.bastion && <CardLine data={data} split="fortress" />}
                {data.bastion != null && data.bastion >= data.fortress && <CardLine data={data} split="bastion" />}
                {data.fortress != null && data.fortress >= data.bastion && <CardLine data={data} split="fortress" />}
                <CardLine data={data} split="first_portal" />
                <CardLine data={data} split="stronghold" />
                <CardLine data={data} split="end" />
                <CardLine data={data} split="finish" />
            </div>
        </div>
    )
}