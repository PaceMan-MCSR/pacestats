'use client'

import ResetScroll from "@/app/components/ResetScroll";
import RangeChange from "@/app/components/RangeChange";
import {NPHStat} from "@/app/components/profile/NPHStat";
import {SessionStat} from "@/app/player/[nick]/session/SessionStat";
export default function SessionPage({name, uuid, nph, data, hours, hoursBetween}: {
    name: string,
    uuid: string,
    nph: any,
    data: any,
    hours: number,
    hoursBetween: number,
}) {
    const skinUrl = "https://mc-api.io/render/FULL/" + uuid
    const headUrl = "https://mc-api.io/render/FACE/" + uuid + "?size=8"
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
                    <SessionStat category="First Portal" data={data["first_portal"]} headUrl={headUrl} name={name} hours={hours} hoursBetween={hoursBetween}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <SessionStat category="Stronghold" data={data["stronghold"]} headUrl={headUrl} name={name} hours={hours} hoursBetween={hoursBetween}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <SessionStat category="End Enter" data={data["end"]} headUrl={headUrl} name={name} hours={hours} hoursBetween={hoursBetween}/>
                </div>
                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                    <Stat category="Finish" data={data["finish"]} headUrl={headUrl} name={name} days={days}/>
                </div>
            </div>
        </div>
    </main>)
}
