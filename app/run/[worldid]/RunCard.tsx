'use client'

/* eslint-disable @next/next/no-img-element -- Tiny WebP icons need no re-encoding; avatars load directly without a server proxy. */

import {formatTime, getLastSplit} from "@/app/utils";
import { mcFont } from "@/app/styles/fonts";
import {useRunStore} from "@/app/run/[worldid]/RunStore";
import PendingLink from "@/app/components/PendingLink";
import {useShallow} from 'zustand/react/shallow';
import {memo} from 'react';
import type {TwitchPlayerInstance} from 'react-twitch-embed';

const CardLine = memo(function CardLine({value, rta, vodOffset, hasVod, embed, split}: {
    value: number | null, rta: number | null, vodOffset: number, hasVod: boolean,
    embed: TwitchPlayerInstance | undefined, split: string,
}) {
    if(value == null){
        return null
    }
    const splitOffset = Math.floor(vodOffset + (Number(rta) / 1000) + 2)
    if(!hasVod || embed === undefined) {
        return <div className="card-line">
            <img className="icon" width={40} height={40} decoding="async" fetchPriority="low" src={"/stats/" + split + ".webp"} alt={split}/>
            <p style={mcFont.style} className="split-name">{formatTime(value)}</p>
        </div>
    } else {
        return <div className="card-line">
            <img className="icon" width={40} height={40} decoding="async" fetchPriority="low" src={"/stats/" + split + ".webp"} alt={split}/>
            <p style={mcFont.style} className="split-name has-vod" onClick={() => {
                embed.seek(splitOffset)
            }}>{formatTime(value)}</p>
        </div>
    }
});

export default function RunCard() {
    const data = useRunStore(useShallow(state => state.data == null ? state.data : {
        id: state.data.id, uuid: state.data.uuid, nickname: state.data.nickname,
        realUpdate: state.data.realUpdate, insertTime: state.data.insertTime,
        vodId: state.data.vodId, vodOffset: state.data.vodOffset,
        nether: state.data.nether, netherRta: state.data.netherRta,
        bastion: state.data.bastion, bastionRta: state.data.bastionRta,
        fortress: state.data.fortress, fortressRta: state.data.fortressRta,
        first_portal: state.data.first_portal, first_portalRta: state.data.first_portalRta,
        stronghold: state.data.stronghold, strongholdRta: state.data.strongholdRta,
        end: state.data.end, endRta: state.data.endRta,
        finish: state.data.finish, finishRta: state.data.finishRta,
    }));
    const vodEmbed = useRunStore(state => state.vodEmbed)

    if (!data) return null;
    const line = (split: string) => <CardLine key={split} split={split} value={data[split]}
        rta={data[split + 'Rta']} vodOffset={data.vodOffset} hasVod={data.vodId !== null} embed={vodEmbed}/>;

    const last = getLastSplit(data, false)
    const headUrl = `https://mc-api.io/render/FACE/${data.uuid}?size=8`

    const start = Math.floor(data.vodOffset + 2)
    const end = Math.floor(data.vodOffset + (data[last.split+ "Rta"] / 1000) + 2)

    const seek = (time: number) => {
        const embed = vodEmbed
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
                <PendingLink href={`/player/${data.nickname}/`} className="nameWrapper">
                    <img className="cardHead" width={40} height={40} decoding="async" src={headUrl} alt={data.nickname}/>
                    <p style={mcFont.style} className="playerName">{data.nickname}</p>
                </PendingLink>
                <p style={mcFont.style} className="runDate">{new Date((data.realUpdate || data.insertTime) * 1000).toLocaleDateString("en-US")}</p>
                <p style={mcFont.style} className="secretId">{data.id}</p>
            </div>
            <div className="card-line-wrapper">
                {line('nether')}
                {data.bastion != null && data.bastion < data.fortress && line('bastion')}
                {data.fortress != null && data.fortress < data.bastion && line('fortress')}
                {data.bastion != null && data.bastion >= data.fortress && line('bastion')}
                {data.fortress != null && data.fortress >= data.bastion && line('fortress')}
                {line('first_portal')}
                {line('stronghold')}
                {line('end')}
                {line('finish')}
            </div>
        </div>
    )
}
