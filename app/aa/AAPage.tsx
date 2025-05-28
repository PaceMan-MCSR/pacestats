'use client'

import RangeChange from "@/app/components/RangeChange";
import FilterChange from "@/app/components/FilterChange";
import ToggleQty from "@/app/components/ToggleQty";
import {useState} from "react";
import {CategoryType} from "@/app/utils";
import {QtyTable} from "@/app/components/tables/QtyTable";
import {AvgTable} from "@/app/components/tables/AvgTable";
import {ConversionTable} from "@/app/components/tables/ConversionTable";
import {FastestAATable} from "@/app/aa/FastestAATable";
import { UsersContext } from "@/app/contexts";

export default function AAPage({searchParams, lb, users}: {
    lb: any,
    users: any,
    searchParams: { [key: string]: string | undefined } }
) {
    const [showSample, setShowSample] = useState(searchParams["showQty"] === "true")
    let days: number = parseInt(searchParams["days"] || "30")
    const input = searchParams["category"]
    let catType = CategoryType.COUNT_AVG
    if(input === "fastest"){
        catType = CategoryType.FASTEST
    } else if(input === "conversion"){
        catType = CategoryType.CONVERSION
    } else if(input === "average"){
        catType = CategoryType.AVG
    }
    if (isNaN(days)) {
        days = 30
    }
    // don't let users specify custom ranges at this stage, to avoid lb cache misses
    if (days !== 1 && days !== 7 && days !== 30 && days !== 9999) {
        days = 30
    }
    return <UsersContext.Provider value={users}>
            <main className="main">
            <div className="container">
                <h1 className="header">All Advancements Stats</h1>
                <div className="row justify-content-center align-content-center">
                    <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                        <div className="topRow mb-2 mt-2">
                            <ToggleQty showSample={showSample} setShowSample={setShowSample}/>
                        </div>
                    </div>
                </div>
                <div className="row">
                    <div className="col-12">
                        <RangeChange/>
                    </div>
                </div>
                <div className="row justify-content-center align-content-center">
                    <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                        <FilterChange/>
                    </div>
                </div>
                {catType === CategoryType.COUNT_AVG && (
                    <div className="row stats-row">
                        <QtyTable catName="Nether Enters" catId="nether" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="Nether Average" catId="nether" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="Bastion Enters" catId="bastion" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="Bastion Average" catId="bastion" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="Fortress Enters" catId="fortress" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="Fortress Average" catId="fortress" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="Stronghold Enters" catId="stronghold" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="Stronghold Average" catId="stronghold" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="End Enters" catId="end" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="End Enter Average" catId="end" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="Elytras Obtained" catId="elytra" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="Elytra Average" catId="elytra" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="End Exits" catId="credits" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="End Exit Average" catId="credits" days={days} lb={lb} showQty={showSample} aa={true}/>

                        <QtyTable catName="Completions" catId="finish" days={days} lb={lb} aa={true}/>
                        <AvgTable catName="Completion Average" catId="finish" days={days} lb={lb} showQty={showSample} aa={true}/>
                    </div>
                )}
                {catType === CategoryType.AVG && (
                    <div className="row stats-row">
                        <AvgTable catName="Nether Average" catId="nether" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="Bastion Average" catId="bastion" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="Fortress Average" catId="fortress" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="Stronghold Average" catId="stronghold" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="End Enter Average" catId="end" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="Elytra Average" catId="elytra" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="End Exit Average" catId="credits" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <AvgTable catName="Completion Average" catId="finish" days={days} lb={lb} showQty={showSample} aa={true}/>
                    </div>
                )}
                {catType === CategoryType.FASTEST && (
                    <div className="row stats-row">
                        <FastestAATable catName="Fastest Nether" catId="nether" days={days} data={lb}/>
                        <FastestAATable catName="Fastest Bastion" catId="bastion" days={days} data={lb}/>
                        <FastestAATable catName="Fastest Fortress" catId="fortress" days={days} data={lb}/>
                        <FastestAATable catName="Fastest Stronghold" catId="stronghold" days={days} data={lb}/>
                        <FastestAATable catName="Fastest End Enter" catId="end" days={days} data={lb}/>
                        <FastestAATable catName="Fastest Elytra" catId="elytra" days={days} data={lb}/>
                        <FastestAATable catName="Fastest End Exit" catId="credits" days={days} data={lb}/>
                        <FastestAATable catName="Fastest Completion" catId="finish" days={days} data={lb}/>
                    </div>
                )}
                {catType === CategoryType.CONVERSION && (
                    <div className="row stats-row">
                        <ConversionTable catName="Bastion Conversion" catId="bastion" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <ConversionTable catName="Fortress Conversion" catId="fortress" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <ConversionTable catName="Stronghold Conversion" catId="stronghold" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <ConversionTable catName="End Conversion" catId="end" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <ConversionTable catName="Elytra Conversion" catId="elytra" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <ConversionTable catName="End Exit Conversion" catId="credits" days={days} lb={lb} showQty={showSample} aa={true}/>
                        <ConversionTable catName="Completion Conversion" catId="finish" days={days} lb={lb} showQty={showSample} aa={true}/>
                    </div>
                )}
                <div className="footer">
                    <a href="https://paceman.gg">Main PaceMan site</a><br/>
                    <a href="/stats/api/">API Documentation</a>
                    <p>Stats site created by <a href="https://twitch.tv/jojoe77777">jojoe77777</a></p>
                </div>
            </div>
        </main>
    </UsersContext.Provider>
}