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
import {AARecentRuns} from "@/app/components/profile/AARecentRuns";
export default function AAPlayerPage({name, uuid, recentRuns, twitches, nph, data, days}: {
    name: string,
    uuid: string,
    recentRuns: {},
    twitches: any[],
    nph: any,
    data: any,
    days: number
}) {
    const skinUrl = "https://mc-heads.net/body/" + uuid
    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"
    return (<main className="main playerStats">
        <div className="container">
            <ResetScroll/>
            <h1 className="header" style={{marginTop: 20, marginBottom: 30}}>
                AA Stats for {name}
                <img className="titleHead mx-2" src={headUrl} alt={name}/>
            </h1>
            <div className="mb-2">
                <RangeChange/>
            </div>
            <div className="row">
                <div className="d-none d-lg-block col-sm-3 col-md-2 col-lg-2 col-xl-2">
                    <img className="playerSkin" src={skinUrl} alt="Player skin"/>
                </div>
                <div className="d-block d-sm-block col-sm-12 col-md-12 col-lg-8 col-xl-7 mb-md-2">
                    <div className="recentContainer mb-2">
                        <AARecentRuns runs={recentRuns}/>
                        <div className="openRuns">
                            <Link href={`/player/${name}/runs/aa`}>
                                <button className="btn btn-dark">More runs</button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
            <div style={{textAlign: "center"}}>
                <h6>Click on a card to optimize for screenshots</h6>
            </div>
            <div className="row stats-row">
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Nether Enters" data={data["nether"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Bastion Enters" data={data["bastion"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Fortress Enters" data={data["fortress"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Stronghold Enters" data={data["stronghold"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="AA End Enters" data={data["end"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Elytras Obtained" data={data["elytra"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="End Exits" data={data["credits"]} headUrl={headUrl} name={name} days={days}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Completions" data={data["finish"]} headUrl={headUrl} name={name} days={days}/>
                </div>
            </div>
        </div>
    </main>)
}