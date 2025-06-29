import { useContext, useEffect, useState } from "react";
import {Entry} from "@/app/types";
import {CategoryType, fixDisplayName, formatTime} from "@/app/utils";
import BoardLink from "@/app/components/tables/BoardLink";
import { UsersContext } from "@/app/contexts";

export function QtyTable({catName, catId, days, lb, aa = false} : {catName: string, catId: string, days: number, lb?: any, aa?: boolean}) {
    const lbSize = 10
    if (lb[CategoryType.COUNT][catId].length === 0) {
        return null
    }

    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <p className="tableHeader">{catName}</p>
        <table className="table table-dark caption-top">
            <thead>
            <tr>
                <th>#</th>
                <th id="name">Name</th>
                <th>Qty</th>
            </tr>
            </thead>
            <tbody>
            {
                Object.entries(lb[CategoryType.COUNT][catId]).slice(0, lbSize).map((entry, entryIdx) => {
                    let d = entry[1] as Entry
                    let name = fixDisplayName(d.name)
                    let skinName = d.name
                    let value: number = d.qty
                    let url = "https://mc-heads.net/avatar/" + skinName + "/8"
                    let avg = d.avg
                    let linkUrl = "/player/" + name + "/"
                    if(aa){
                        linkUrl = "/player/" + name + "/aa/"
                    }
                    return <tr key={entryIdx}>
                        <td className="col-1"><p>{entryIdx + 1}</p></td>
                        <td className="col-10">
                            <BoardLink name={name} uuid={d.uuid} url={url} linkUrl={linkUrl}/>
                        </td>
                        <td className="col-1" title={formatTime(avg)} style={{textAlign: "right"}}>
                            <p>
                                {value.toString()}
                            </p>
                        </td>
                    </tr>
                })
            }
            </tbody>
        </table>
    </div>
}