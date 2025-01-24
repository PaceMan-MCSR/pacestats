import {
    CategoryType,
    fixDisplayName,
    generateHexCode,
    getGoodAAQty,
    getGoodQty,
    getMinAAQty,
    getMinQty
} from "@/app/utils";
import {useEffect, useState} from "react";
import {Entry} from "@/app/types";
import Link from "next/link";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import BoardLink from "@/app/components/tables/BoardLink";

export function ConversionTable({catName, catId, days, lb, showQty = false, aa = false} : {catName: string, catId: string, days: number, lb?: any, showQty: boolean, aa?: boolean}) {
    let minQty = getMinQty(catId, days)
    let good = getGoodQty(catId, days)

    if(aa) {
        minQty = getMinAAQty(catId, days)
        good = getGoodAAQty(catId, days)
    }
    const lbSize = 10
    const [data, setData] = useState([])
    const [isLoading, setLoading] = useState(true)

    useEffect(() => {
        if(lb){
            setData(lb[CategoryType.CONVERSION][catId])
            setLoading(false)
            return
        }
        fetch(process.env.NEXT_PUBLIC_HOSTNAME + `/stats/api/getLeaderboard/?category=${catId}&type=conversion&days=${days}`)
            .then((res) => res.json())
            .then((data) => {
                setData(data)
                setLoading(false)
            })
    }, [])

    if(isLoading){
        return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
            <p className="tableHeader">{catName}</p>
            <table className="table table-dark caption-top">
                <thead>
                <tr>
                    <th>#</th>
                    <th id="name">Name</th>
                    {showQty && <th>Qty</th>}
                    <th>Rate</th>
                </tr>
                </thead>
                <tbody>
                {
                    Array.from(Array(10).keys()).map((entryIdx) => {
                        return <tr key={entryIdx}>
                            <td className="col-1"><p>{entryIdx + 1}</p></td>
                            <td className="col-10">
                                <p>
                                    <img className="avatar dummyAvatar" src="https://mc-heads.net/avatar/COVlD19/8" alt="Loading"/>
                                </p>
                                <div className="loadingSkeleton"></div>
                            </td>
                            {showQty &&
                                <td className="col-1" style={{textAlign: "right"}}>
                                    <p>...</p>
                                </td>
                            }
                            <td className="col-1">
                                <p>
                                    ...
                                </p>
                            </td>
                        </tr>
                    })
                }
                </tbody>
            </table>
        </div>
    }
    if (data.length === 0) {
        return null
    }

    let mid = Math.floor((minQty + good) / 2)
    const leftColor = generateHexCode(minQty, minQty, good)
    const rightColor = generateHexCode(good, good, good)

    // Fix centering for small values
    const midMargin = minQty < 100 && (mid >= 100 || (minQty < 10 && mid >= 10)) ? 8 : 0


    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <OverlayTrigger overlay={
            <Tooltip className="colorTooltip">
                <p className="colorHint justify-content-center justify-self-center">Sample size</p>
                <div style={{backgroundImage:`linear-gradient(to right, ${leftColor}, ${rightColor})`}} className="d-flex justify-content-between colorHeader">
                    <p className="d-flex colorCaption">{minQty}</p>
                    {mid >= 10 && <p className="d-flex colorCaption midQty" style={{marginLeft:midMargin}}>{mid}</p>}
                    <p className="d-flex colorCaption">{good}</p>
                </div>
            </Tooltip>
        } delay={{ show: 0, hide: 800 }}>
            <p className="tableHeader">{catName}</p>
        </OverlayTrigger>
        <table className="table table-dark caption-top">
            <thead>
            <tr>
                <th>#</th>
                <th id="name">Name</th>
                {showQty && <th>Qty</th>}
                <th>Rate</th>
            </tr>
            </thead>
            <tbody>
            {
                data.slice(0, lbSize).map((entry, entryIdx) => {
                    let d = entry as Entry
                    let name = fixDisplayName(d.name)
                    let skinName = d.name
                    if(showQty && name.length > 12){
                        name = name.slice(0, 12)
                    }
                    let value: number = d.value
                    let url = "https://mc-heads.net/avatar/" + skinName + "/8"
                    let count: string = d.qty.toString()
                    let linkUrl = "/player/" + name + "/"
                    if(aa){
                        linkUrl = "/player/" + name + "/aa/"
                    }
                    const color = generateHexCode(d.qty, minQty, good)
                    return <tr key={entryIdx}>
                        <td className="col-1"><p>{entryIdx + 1}</p></td>
                        <td className="col-10">
                            <BoardLink name={name} url={url} linkUrl={linkUrl}/>
                        </td>
                        {showQty &&
                            <td className="col-1" style={{textAlign: "right"}}>
                                <p>{count}</p>
                            </td>
                        }
                        <td className="col-1" title={count}>
                            <p style={{color:color}}>
                                {value.toFixed(1) + "%"}
                            </p>
                        </td>
                    </tr>
                })
            }
            </tbody>
        </table>
    </div>
}