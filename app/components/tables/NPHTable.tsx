import {fixDisplayName, formatDecimals, formatTime, generateHexCode, getGoodQty, getMinQty} from "@/app/utils";
import BoardLink from "@/app/components/tables/BoardLink";
import React, {useState} from "react";
import {Collapse} from "react-bootstrap";
import TimeSlider from "@/app/components/TimeSlider";
import NPHSlider from "@/app/components/NPHSlider";
import QtySlider from "@/app/components/QtySlider";

export function NPHTable({days, data, showQty = false} : {days: number, data?: any, showQty: boolean}) {
    const lbSize = 10
    const minQty = getMinQty("nether", days)
    const good = getGoodQty("nether", days)
    const [nph, setNph] = useState(8);
    const [avg, setAvg] = useState(95);
    const [qty, setQty] = useState(getMinQty("nether", days));
    const [toggled, setToggled] = useState(false);
    const [useWeight, setUseWeight] = useState(false);

    if (data.length === 0) {
        return null
    }

    let mid = Math.floor((minQty + good) / 2)
    const leftColor = generateHexCode(minQty, minQty, good)
    const rightColor = generateHexCode(good, good, good)

    // Fix centering for small values
    const midMargin = minQty < 100 && (mid >= 100 || (minQty < 10 && mid >= 10)) ? 8 : 0
    let filtered = data.filter((entry: {
        uuid: string,
        nick: string,
        avg: number,
        qty: number,
        nph: number
    }) => entry.nph >= nph && (entry.avg / 1000) <= avg && entry.qty >= qty)
    //sort by nph
    filtered.sort((a: { nph: number }, b: { nph: number }) => b.nph - a.nph)

    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <button
            className={"btn btn-dark filterToggle" + (toggled ? " active" : "")}
            type="button"
            onClick={() => {
                setToggled(!toggled)
            }}
        >Show Advanced
        </button>
        <Collapse in={toggled}>
            <div className="nphOptions">
                <h6>NPH: {nph}, avg: {formatTime(avg * 1000, true)}, qty: {qty}</h6>
                <TimeSlider def={avg} setVal={setAvg}/>
                <NPHSlider def={nph} setVal={setNph}/>
                <QtySlider def={qty} setVal={setQty}/>
            </div>
        </Collapse>
        <table className="table table-dark caption-top">
            <thead>
            <tr>
                <th id="num">#</th>
                <th id="name">Name</th>
                {showQty && <th id="qty">Qty</th>}
                <th id="nph" style={{paddingRight:0}}>NPH</th>
                <th id="avg">Avg</th>
            </tr>
            </thead>
            <tbody>
            {
                // @ts-ignore
                filtered.slice(0, 10).map((entry, entryIdx) => {
                    let d = entry as {uuid: string, nick: string, avg: number, qty: number, nph: number}
                    let name = fixDisplayName(d.nick)
                    let skinName = d.nick
                    let avg: number = d.avg
                    let nph: string = d.nph.toString()
                    let url = "https://mc-heads.net/avatar/" + skinName + "/8"
                    let count: string = d.qty.toString()
                    let valueFormatted: string
                    valueFormatted = formatTime(avg, false)
                    let linkUrl = "/player/" + name
                    const color = generateHexCode(d.qty + (minQty / 5), minQty, good)
                    const truncated = name.length > 12 ? name.substring(0, 12) : name
                    return <tr key={entryIdx}>
                        <td className="col-1"><p>{entryIdx + 1}</p></td>
                        <td className="col-10">
                            <BoardLink name={showQty ? truncated : name} url={url} linkUrl={linkUrl}/>
                        </td>
                        {showQty &&
                            <td className="col-1" style={{textAlign: "right"}}>
                                <p style={{color:color}} >{count}</p>
                            </td>
                        }
                        <td className="col-1" style={{paddingRight:0}} title={nph}>
                            <p style={{color:color}}>
                                {parseFloat(nph).toFixed(1)}
                            </p>
                        </td>
                        <td className="col-1" title={count}>
                            <p style={{color:color}}>
                                {valueFormatted}
                            </p>
                        </td>
                    </tr>
                })
            }
            </tbody>
        </table>
    </div>
}