import {
    CategoryType,
    fixDisplayName,
    formatTime,
    generateHexCode, getGoodAAQty,
    getGoodQty,
    getMinAAQty,
    getMinQty
} from "@/app/utils";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import Tooltip from "react-bootstrap/Tooltip";
import {Entry} from "@/app/types";
import BoardLink from "@/app/components/tables/BoardLink";

export function AvgTable({catName, catId, days, lb, showQty = false, aa = false} : {catName: string, catId: string, days: number, lb?: any, showQty: boolean, aa?: boolean}) {
    let minQty = getMinQty(catId, days)
    let good = getGoodQty(catId, days)

    if(aa) {
        minQty = getMinAAQty(catId, days)
        good = getGoodAAQty(catId, days)
    }

    const lbSize = 10

    if (lb[CategoryType.AVG][catId].length === 0) {
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
                <th id="num">#</th>
                <th id="name">Name</th>
                {showQty && <th id="qty">Qty</th>}
                <th id="avg">Avg</th>
            </tr>
            </thead>
            <tbody>
            {
                lb[CategoryType.AVG][catId].slice(0, lbSize).map((entry: any, entryIdx: any) => {
                    let d = entry as Entry
                    let name = fixDisplayName(d.name)
                    let skinName = d.name
                    let value: number = d.value
                    let url = "https://mc-heads.net/avatar/" + skinName + "/8"
                    let count: string = d.qty.toString()
                    let valueFormatted: string
                    valueFormatted = formatTime(value, false)
                    let linkUrl = "/player/" + name + "/"
                    if(aa){
                        linkUrl = "/player/" + name + "/aa/"
                    }
                    const color = generateHexCode(d.qty, minQty, good)
                    const truncated = name.length > 12 ? name.substring(0, 12) : name
                    return <tr key={entryIdx}>
                        <td className="col-1"><p>{entryIdx + 1}</p></td>
                        <td className="col-10">
                            <BoardLink name={showQty ? truncated : name} uuid={d.uuid} url={url} linkUrl={linkUrl}/>
                        </td>
                        {showQty &&
                            <td className="col-1" style={{textAlign: "right"}}>
                                <p style={{color:color}} >{count}</p>
                            </td>
                        }
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