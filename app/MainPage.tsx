'use client'

import RangeChange from "@/app/components/RangeChange";
import FilterChange from "@/app/components/FilterChange";
import ToggleQty from "@/app/components/ToggleQty";
import {useState} from "react";
import {CategoryType} from "@/app/utils";
import {FastestTable} from "@/app/components/tables/FastestTable";
import {QtyTable} from "@/app/components/tables/QtyTable";
import {AvgTable} from "@/app/components/tables/AvgTable";
import {ConversionTable} from "@/app/components/tables/ConversionTable";
import BastionFort from "@/app/components/BastionFort";
import {NPHTable} from "@/app/components/tables/NPHTable";
import {UsersContext} from "@/app/contexts";

export default function MainPage({searchParams, nph, lb, users}: {
    lb: any,
    nph: any,
    users: any,
    searchParams: { [key: string]: string | undefined } }
) {
    const [showSample, setShowSample] = useState(searchParams["showQty"] === "true")
    const [bastionFort, setBastionFort] = useState(searchParams["bastionFort"] === "true")
    const showNph = nph && searchParams["nph"] === "true"
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
            <h1 className="header">Stats Leaderboards</h1>
            <h6 className="subheader">Click on a player to see their stats</h6>
            <div className="row justify-content-center align-content-center">
                <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                    <div className="topRow mb-2">
                        <ToggleQty showSample={showSample} setShowSample={setShowSample}/>
                        <BastionFort bastionFort={bastionFort} setBastionFort={setBastionFort}/>
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
                    {showNph && (
                        <NPHTable days={days} showQty={showSample} data={nph}/>
                    )}
                    <QtyTable catName="Nether Enters" catId="nether" days={days} lb={lb}/>
                    <AvgTable catName="Nether Average" catId="nether" days={days} lb={lb} showQty={showSample}/>

                    {bastionFort && (
                        <QtyTable catName="Bastion Enters" catId="bastion" days={days} lb={lb}/>
                    )}
                    {bastionFort && (
                        <AvgTable catName="Bastion Average" catId="bastion" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {bastionFort && (
                        <QtyTable catName="Fortress Enters" catId="fortress" days={days} lb={lb}/>
                    )}
                    {bastionFort && (
                        <AvgTable catName="Fortress Average" catId="fortress" days={days} lb={lb} showQty={showSample}/>
                    )}

                    {!bastionFort && (
                        <QtyTable catName="Structure 1 Enters" catId="first_structure" days={days} lb={lb}/>
                    )}
                    {!bastionFort && (
                        <AvgTable catName="Structure 1 Average" catId="first_structure" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {!bastionFort && (
                        <QtyTable catName="Structure 2 Enters" catId="second_structure" days={days} lb={lb}/>
                    )}
                    {!bastionFort && (
                        <AvgTable catName="Structure 2 Average" catId="second_structure" days={days} lb={lb} showQty={showSample}/>
                    )}

                    <QtyTable catName="First Portals" catId="first_portal" days={days} lb={lb}/>
                    <AvgTable catName="First Portal Average" catId="first_portal" days={days} lb={lb} showQty={showSample}/>

                    <QtyTable catName="Stronghold Enters" catId="stronghold" days={days} lb={lb}/>
                    <AvgTable catName="Stronghold Average" catId="stronghold" days={days} lb={lb} showQty={showSample}/>

                    <QtyTable catName="End Enters" catId="end" days={days} lb={lb}/>
                    <AvgTable catName="End Average" catId="end" days={days} lb={lb} showQty={showSample}/>

                    <QtyTable catName="Completions" catId="finish" days={days} lb={lb}/>
                    <AvgTable catName="Completion Average" catId="finish" days={days} lb={lb} showQty={showSample}/>
                </div>
            )}
            {catType === CategoryType.AVG && (
                <div className="row stats-row">
                    <AvgTable catName="Nether Average" catId="nether" days={days} lb={lb} showQty={showSample}/>
                    {bastionFort && (
                        <AvgTable catName="Bastion Average" catId="bastion" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {bastionFort && (
                        <AvgTable catName="Fortress Average" catId="fortress" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {!bastionFort && (
                        <AvgTable catName="Structure 1 Average" catId="first_structure" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {!bastionFort && (
                        <AvgTable catName="Structure 2 Average" catId="second_structure" days={days} lb={lb} showQty={showSample}/>
                    )}
                    <AvgTable catName="First Portal Average" catId="first_portal" days={days} lb={lb} showQty={showSample}/>
                    <AvgTable catName="Stronghold Average" catId="stronghold" days={days} lb={lb} showQty={showSample}/>
                    <AvgTable catName="End Average" catId="end" days={days} lb={lb} showQty={showSample}/>
                    <AvgTable catName="Completion Average" catId="finish" days={days} lb={lb} showQty={showSample}/>
                </div>
            )}
            {catType === CategoryType.FASTEST && (
                <div className="row stats-row">
                    <FastestTable catName="Fastest Nether" catId="nether" days={days}/>
                    {bastionFort && (
                        <FastestTable catName="Fastest Bastion" catId="bastion" days={days}/>
                    )}
                    {bastionFort && (
                        <FastestTable catName="Fastest Fortress" catId="fortress" days={days}/>
                    )}
                    {!bastionFort && (
                        <FastestTable catName="Fastest Structure 1" catId="first_structure" days={days}/>
                    )}
                    {!bastionFort && (
                        <FastestTable catName="Fastest Structure 2" catId="second_structure" days={days}/>
                    )}
                    <FastestTable catName="Fastest First Portal" catId="first_portal" days={days}/>
                    <FastestTable catName="Fastest Stronghold" catId="stronghold" days={days}/>
                    <FastestTable catName="Fastest End Enter" catId="end" days={days}/>
                    <FastestTable catName="Fastest Completion" catId="finish" days={days}/>
                </div>
            )}
            {catType === CategoryType.CONVERSION && (
                <div className="row stats-row">
                    {bastionFort && (
                        <ConversionTable catName="Bastion Conversion" catId="bastion" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {bastionFort && (
                        <ConversionTable catName="Fortress Conversion" catId="fortress" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {!bastionFort && (
                        <ConversionTable catName="Structure 1 Conversion" catId="first_structure" days={days} lb={lb} showQty={showSample}/>
                    )}
                    {!bastionFort && (
                        <ConversionTable catName="Structure 2 Conversion" catId="second_structure" days={days} lb={lb} showQty={showSample}/>
                    )}
                    <ConversionTable catName="First Portal Conversion" catId="first_portal" days={days} lb={lb} showQty={showSample}/>
                    <ConversionTable catName="Stronghold Conversion" catId="stronghold" days={days} lb={lb} showQty={showSample}/>
                    <ConversionTable catName="End Conversion" catId="end" days={days} lb={lb} showQty={showSample}/>
                    <ConversionTable catName="Completion Conversion" catId="finish" days={days} lb={lb} showQty={showSample}/>
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