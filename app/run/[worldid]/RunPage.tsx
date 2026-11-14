'use client'

import {TwitchChat, TwitchPlayer} from "react-twitch-embed";
import type {TwitchPlayerInstance} from "react-twitch-embed";
import {useRunStore, useRunStoreApi} from "./RunStore";
import type {WorldSnapshot} from "./RunStore";
import ResetScroll from "@/app/components/ResetScroll";
import "../../styles/run.css"
import RunData from "@/app/run/[worldid]/RunData";
import {useEffect, useState} from "react";
import RunCard from "@/app/run/[worldid]/RunCard";
import RunButtons from "@/app/run/[worldid]/RunButtons";
import RunHeader from "@/app/run/[worldid]/RunHeader";

export default function RunPage({params, initialWorld}: {
    params: { worldid: string },
    initialWorld: WorldSnapshot,
}) {
    const store = useRunStoreApi();
    const isLive = useRunStore(state => state.isLive);
    const isLoading = useRunStore(state => state.isLoading);
    const data = useRunStore(state => state.data);
    const [vodFailed, setVodFailed] = useState(false)
    const [hasBeenLive, setHasBeenLive] = useState(false)

    const handleVod = (e: TwitchPlayerInstance) => {
        store.setState({
            vodEmbed: e
        })
    };

    useEffect(() => {
        if(!isLoading && data?.vodId){
            const timer = setTimeout(() => {
                const state = store.getState()
                if(!state.isLive && state.data && state.data.vodId && !state.vodEmbed){
                    console.log("Loading VOD failed after 10 seconds")
                    setVodFailed(true)
                }
            }, 10000)
            return () => clearTimeout(timer);
        }
    }, [isLoading, data?.vodId, store])

    const handleLive = (e: TwitchPlayerInstance) => {
        store.setState({
            liveEmbed: e
        })
        setHasBeenLive(true)
    };

    if(isLoading || data === undefined){
        return (<main className="main world">
                <div className="container">
                    <ResetScroll/>
                    <RunData params={params} initialWorld={initialWorld}/>
                    <div className="row justify-content-center">
                        <div className="col-lg-8 col-xl-7">
                            <h1 className="header mb-4">
                                Loading...
                            </h1>
                        </div>
                    </div>
                </div>
            </main>
        )
    }

    if(data === null){
        return (<main className="main world">
                <div className="container">
                    <ResetScroll/>
                    <RunData params={params} initialWorld={initialWorld}/>
                    <div className="row justify-content-center">
                        <div className="col-12">
                            <h1 className="header mb-4">
                                Unknown run
                            </h1>
                        </div>
                    </div>
                    <div className="row justify-content-center">
                        <div className="col-12 unknownRun">
                            <p>ID must be a world ID hash or the numerical ID of a run</p>
                        </div>
                    </div>
                </div>
            </main>
        )
    }

    return (
        <main className="main world">
            <div className="container">
                <ResetScroll />
                <RunData params={params} initialWorld={initialWorld}/>
                <div className="row">
                    <div className="col-12 twitchWrapper">
                        {!vodFailed && !isLive && data.vodId && (
                            <div className="vod">
                                <div className="noBlack"></div>
                                <TwitchPlayer id={"vod"} video={data.vodId} time={data.vodOffset}
                                              width={"100%"} height={"100%"}
                                              autoplay={true} muted onReady={handleVod} />
                            </div>
                        )}
                        {!isLive && !hasBeenLive && vodFailed && (
                            <div className="vod fake">
                                <div className="fakeVod">
                                    <p>VOD is private or deleted</p>
                                </div>
                            </div>
                        )}
                        {isLive && data.twitch && (
                            <div className="live">
                                <TwitchPlayer id={"live"} channel={data.twitch}
                                              width={"100%"} height={"100%"}
                                              muted onReady={handleLive} />
                                <div className="chatWrapper">
                                    <div className="chat">
                                        <TwitchChat channel={data.twitch} darkMode={true} height={"100%"} width={"100%"} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                {isLive && data.twitch && (
                    <div className="chatBuffer"></div>
                )}
                <div className="row justify-content-center">
                    <div className="col-12">
                        <RunHeader />
                    </div>
                </div>
                <div className="row justify-content-center">
                    <div className="col-12">
                        <RunCard />
                    </div>
                </div>
                <div className="row justify-content-center align-content-center">
                    <div className="col-12">
                        <RunButtons/>
                    </div>
                </div>
                <div className="row justify-content-center align-content-center mt-3">
                    <div className="col-12 col-sm-10 col-lg-8 col-xl-7 col-xxl-6">
                        <h2 className="header">Useful Information</h2>
                        <ul className="faq-list">
                            <li>Click on the player&apos;s name to view their profile</li>
                            <li>Splits from live runs are updated every 3 seconds automatically</li>
                            <li>For runs with VODs, click on splits in the run card to jump timestamps</li>
                            <li>Rewind to the start of a run by refreshing (or click the left side of card)</li>
                        </ul>
                    </div>
                </div>
            </div>
        </main>
    )
}
