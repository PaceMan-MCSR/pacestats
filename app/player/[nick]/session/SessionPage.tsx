'use client'

import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import RangeChange from "@/app/components/RangeChange";
import {RecentRuns} from "@/app/components/profile/RecentRuns";
import {Stat} from "@/app/components/profile/Stat";
import {TwitchEntry} from "@/app/components/profile/TwitchEntry";
import {NPHStat} from "@/app/components/profile/NPHStat";
import BastionFort from "@/app/components/BastionFort";
import {useState} from "react";
import { SessionStat } from "@/app/player/[nick]/session/SessionStat";
export default async function SessionPage({name, uuid, twitches, nph, data, hours, hoursBetween}: {
    name: string,
    uuid: string,
    twitches: any[],
    nph: any,
    data: any,
    hours: number,
    hoursBetween: number,
}) {
    const skinUrl = "https://mc-heads.net/body/" + uuid
    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"
    const days = 0;
    return (<main className="main playerStats">
        <div className="container">
            <ResetScroll/>
            <h1 className="header" style={{marginTop: 20, marginBottom: 30}}>
                Session stats for {name}
                <img className="titleHead mx-2" src={headUrl} alt={name}/>
            </h1>
            <div className="mb-4">
                <RangeChange/>
            </div>
            <div style={{textAlign: "center"}}>
                <h6>Click on a card to optimize for screenshots</h6>
            </div>
            <div className="row stats-row">
                {nph.count > 0 && (
                    <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                        <NPHStat nick={name} data={nph} headUrl={headUrl} days={days}/>
                    </div>
                )}
                {nph.count === 0 && (
                    <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                        <NPHStat data={null} nick={name}/>
                    </div>
                )}
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <SessionStat category="Nether Enters" data={data["nether"]} headUrl={headUrl} name={name} hours={hours} hoursBetween={hoursBetween}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="First Portal" data={data["first_portal"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Stronghold" data={data["stronghold"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="End Enter" data={data["end"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Finish" data={data["finish"]} headUrl={headUrl} name={name} days={days}/>
                </div>
            </div>
        </div>
    </main>)
}