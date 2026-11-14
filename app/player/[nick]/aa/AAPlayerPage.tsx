'use client'

import type {RecentRunRow} from '@/app/components/profile/recentRunPresentation';

import ResetScroll from "@/app/components/ResetScroll";
import RangeChange from "@/app/components/RangeChange";
import {Stat} from "@/app/components/profile/Stat";
import {AARecentRuns} from "@/app/components/profile/AARecentRuns";
import PendingLink from "@/app/components/PendingLink";
import {useDeferredPrefetch} from "@/app/components/useDeferredPrefetch";
export default function AAPlayerPage({name, uuid, recentRuns, data, days}: {
    name: string,
    uuid: string,
    recentRuns: RecentRunRow[],
    data: any,
    days: number
}) {
    const skinUrl = "https://mc-api.io/render/FULL/" + uuid
    const headUrl = "https://mc-api.io/render/FACE/" + uuid + "?size=8"
    const moreRunsHref = `/player/${name}/runs/aa`;
    const prepareMoreRuns = useDeferredPrefetch(moreRunsHref);
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
                            <PendingLink href={moreRunsHref} prefetch={prepareMoreRuns}>
                                <button className="btn btn-dark">More runs</button>
                            </PendingLink>
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
