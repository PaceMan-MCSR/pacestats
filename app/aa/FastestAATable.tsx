import {useEffect, useState} from "react";
import {CategoryType, fixDisplayName, formatTime} from "@/app/utils";
import {Entry, FastestEntry} from "@/app/types";
import BoardLink from "@/app/components/tables/BoardLink";

export function FastestAATable({catName, catId, days, data} : {catName: string, catId: string, days: number, data: any}) {
    const [isLoading, setLoading] = useState(true)

    useEffect(() => {
        if(data){
            setLoading(false)
            return
        }
    }, [])

    const lbSize = 10
    if(isLoading){
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
                    Array.from(Array(10).keys()).map((entryIdx) => {
                        return <tr key={entryIdx}>
                            <td className="col-1"><p>{entryIdx + 1}</p></td>
                            <td className="col-10">
                                <p>
                                    <img className="avatar dummyAvatar" src="https://mc-heads.net/avatar/COVlD19/8" alt="Loading"/>
                                </p>
                                <div className="loadingSkeleton"></div>
                            </td>
                            <td className="col-1"><p>...</p></td>
                        </tr>
                    })
                }
                </tbody>
            </table>
        </div>
    }
    if(data[CategoryType.FASTEST][catId].length === 0) {
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
                Object.entries(data[CategoryType.FASTEST][catId]).slice(0, lbSize).map((entry, entryIdx) => {
                    let d = entry[1] as FastestEntry
                    let name = fixDisplayName(d.name)
                    let skinName = d.name
                    let value: string = formatTime(d.value)
                    let url = "https://mc-heads.net/avatar/" + skinName + "/8"
                    let linkUrl = "/player/" + name + "/aa/"
                    let runId = d.runId
                    return <tr key={entryIdx}>
                        <td className="col-1"><p>{entryIdx + 1}</p></td>
                        <td className="col-10">
                            <BoardLink name={name} uuid={d.uuid} url={url} linkUrl={linkUrl}/>
                        </td>
                        <td className="col-1">
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