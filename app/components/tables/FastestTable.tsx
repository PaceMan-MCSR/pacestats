import {useState} from "react";
import { CategoryType, fixDisplayName, formatTime } from "@/app/utils";
import {FastestEntry} from "@/app/types";
import BoardLink from "@/app/components/tables/BoardLink";

export function FastestTable({catName, catId, days, lb} : {catName: string, catId: string, days: number, lb: any}) {
    if (lb[catId].length === 0) {
        return null
    }

    return <div className="tableWrapper col-sm-12 col-md-6 col-xl-4 col-xxl-3">
        <p className="tableHeader">{catName}</p>
        <table className="table table-dark caption-top">
            <thead>
            <tr>
                <th>#</th>
                <th id="name">Name</th>
                <th>Time</th>
            </tr>
            </thead>
            <tbody>
            {
                Object.entries(lb[catId]).map((entry, entryIdx) => {
                    let d = entry[1] as FastestEntry
                    let name = fixDisplayName(d.name)
                    let skinName = d.name
                    let value: string = formatTime(d.value)
                    let url = "https://mc-heads.net/avatar/" + skinName + "/8"
                    let linkUrl = "/player/" + name
                    let runId = d.runId
                    return <tr key={entryIdx}>
                        <td className="col-1"><p>{entryIdx + 1}</p></td>
                        <td className="col-10">
                            <BoardLink name={name} uuid={d.uuid} url={url} linkUrl={linkUrl}/>
                        </td>
                        <td className="col-1">
                            <a href={`/stats/run/${runId}`} style={{marginLeft: 5, textDecoration: "none"}}>
                                <p>
                                    {value.toString()}
                                </p>
                            </a>
                        </td>
                    </tr>
                })
            }
            </tbody>
        </table>
    </div>
}