'use client'

import Link from "next/link";
import ResetScroll from "@/app/components/ResetScroll";
import RangeChange from "@/app/components/RangeChange";
import { RecentRuns } from "@/app/components/profile/RecentRuns";
import { Stat } from "@/app/components/profile/Stat";
import { TwitchEntry } from "@/app/components/profile/TwitchEntry";
import { NPHStat } from "@/app/components/profile/NPHStat";
import BastionFort from "@/app/components/BastionFort";
import { useState } from "react";
import { UserColoursContext, UsersContext } from "@/app/contexts";
import { defaultNameColor, getDarkerColor, getDisplayName, getNameColor, getUserColours } from "@/app/utils";
import Box from "@mui/material/Box";

export default function PlayerPage({name, uuid, recentRuns, twitches, nph, data, days, bf, users}: {
    name: string,
    uuid: string,
    recentRuns: {},
    twitches: any[],
    nph: any,
    data: any,
    days: number,
    bf: boolean,
    users: any
}) {
    const skinUrl = "https://mc-heads.net/body/" + uuid
    const headUrl = "https://mc-heads.net/avatar/" + uuid + "/8"
    const [bastionFort, setBastionFort] = useState(bf)
    const nameColor = getNameColor(users, uuid)
    const colours : any = getUserColours(users, uuid)
    return (
        <UsersContext.Provider value={users}>
            <UserColoursContext.Provider value={colours}>
                <main className="main playerStats" style={{
                    backgroundColor: `#${colours?.bg}`,
                    height: "100%",
                    minHeight: "calc(100vh - 56px)",
                }}>
                    <div className="container">
                        <ResetScroll/>
                        <h1 className="header" style={{marginTop: 0, paddingTop: 30, marginBottom: 30}}>
                            <span style={{
                                color: nameColor,
                                filter: `drop-shadow(0px 0px 2px #000000)`
                            }}>Stats for {getDisplayName(users, uuid, name)}</span>
                            <img className="titleHead mx-2" style={nameColor !== defaultNameColor ? {
                                marginTop: "-5px",
                                border: "2px solid " + nameColor,
                                boxSizing: "content-box",
                                filter: `drop-shadow(0px 0px 2px #000000)`
                            } : {marginTop: "-5px"}} src={headUrl} alt={name}/>
                        </h1>
                        <div className="mb-2" style={{textAlign: "center"}}>
                            <BastionFort bastionFort={bastionFort} setBastionFort={setBastionFort}/>
                        </div>
                        <div className="mb-2">
                            <RangeChange/>
                        </div>
                        <div className="row">
                            <div className="d-none d-lg-block col-sm-3 col-md-2 col-lg-2 col-xl-2">
                                <img className="playerSkin" src={skinUrl} style={nameColor !== defaultNameColor ? {
                                    filter: `drop-shadow(0px 0px 3px ${nameColor}) drop-shadow(0px 0px 5px #000000)`
                                } : {}} alt="Player skin"/>
                            </div>
                            <div className="d-block d-sm-block col-sm-12 col-md-12 col-lg-8 col-xl-7 mb-md-2">
                                <div className="recentContainer mb-2">
                                    <RecentRuns runs={recentRuns}/>
                                    <div className="openRuns">
                                        <Link href={`/player/${name}/runs`}>
                                            <Box sx={colours.isCustom ? {
                                                '& button': {
                                                    backgroundColor: `#${colours.fg} !important`,
                                                    ...colours.fgText
                                                },
                                                '& button:hover': {
                                                    backgroundColor: `#${getDarkerColor(colours.fg, 0.9)} !important`,
                                                    ...colours.fgText
                                                }
                                            } : {}}>
                                                <button className="btn btn-dark">More runs</button>
                                            </Box>
                                        </Link>
                                    </div>
                                </div>
                            </div>
                            <div className="col-12 col-sm-6 col-md-6 col-lg-2 col-xl-3">
                                {twitches !== null && twitches.length > 0 ?
                                    <h4 className="twitchHeader" style={colours.isCustom ? {
                                        color: `#${colours.name}`,
                                        filter: `drop-shadow(0px 0px 2px #000000)`
                                    } : {}}>Twitch Accounts</h4> : null}
                                {twitches !== null ? twitches.map((twitch, idx) => <TwitchEntry key={idx}
                                                                                                twitch={twitch}/>) : null}
                            </div>
                            <div className="d-none d-sm-block d-md-block d-lg-none col-sm-6 col-md-6 mt-md-5">
                                <img
                                    className={twitches !== null && twitches.length > 1 ? "playerSkin-tall" : "playerSkin"}
                                    src={skinUrl} alt="Player skin"/>
                            </div>
                        </div>
                        <div style={{textAlign: "center"}}>
                            <h6 style={colours.isCustom ? {
                                color: `#${colours.name}`,
                                filter: `drop-shadow(0px 0px 2px #000000)`
                            } : {}}>Click on a card to optimize for screenshots</h6>
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
                                <Stat category="Nether Enters" data={data["nether"]} headUrl={headUrl} name={name}
                                      days={days}/>
                            </div>
                            {bastionFort && (
                                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                    <Stat category="Bastion" data={data["bastion"]} headUrl={headUrl} name={name}
                                          days={days}/>
                                </div>
                            )}
                            {bastionFort && (
                                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                    <Stat category="Fortress" data={data["fortress"]} headUrl={headUrl} name={name}
                                          days={days}/>
                                </div>
                            )}
                            {!bastionFort && (
                                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                    <Stat category="First Structure" data={data["first_structure"]} headUrl={headUrl}
                                          name={name} days={days}/>
                                </div>
                            )}
                            {!bastionFort && (
                                <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                    <Stat category="Second Structure" data={data["second_structure"]} headUrl={headUrl}
                                          name={name} days={days}/>
                                </div>
                            )}
                            <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                <Stat category="First Portal" data={data["first_portal"]} headUrl={headUrl} name={name}
                                      days={days}/>
                            </div>
                            <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                <Stat category="Stronghold" data={data["stronghold"]} headUrl={headUrl} name={name}
                                      days={days}/>
                            </div>
                            <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                <Stat category="End Enter" data={data["end"]} headUrl={headUrl} name={name}
                                      days={days}/>
                            </div>
                            <div className="col-sm-12 col-md-6 col-xl-4 col-xxl-3">
                                <Stat category="Finish" data={data["finish"]} headUrl={headUrl} name={name}
                                      days={days}/>
                            </div>
                        </div>
                    </div>
                    {name === "therowdie" && (
                        <img src="/stats/rowdcat.gif" alt="Cat" style={{
                            position: "fixed",
                            bottom: "0",
                            right: "0",
                            maxWidth: "160px",
                        }}/>
                    )}
                </main>
            </UserColoursContext.Provider>
        </UsersContext.Provider>)
}