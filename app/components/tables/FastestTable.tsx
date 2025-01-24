import {useEffect, useState} from "react";
import {fixDisplayName, formatTime} from "@/app/utils";
import {Entry, FastestEntry} from "@/app/types";
import BoardLink from "@/app/components/tables/BoardLink";

export function FastestTable({catName, catId, days} : {catName: string, catId: string, days: number}) {
    const [data, setData] = useState([])
    const [isLoading, setLoading] = useState(true)

    useEffect(() => {
        fetch(process.env.NEXT_PUBLIC_HOSTNAME + `/stats/api/getFastest/?category=${catId}&days=${days}`)
            .then((res) => res.json())
            .then((data) => {
                setData(data)
                setLoading(false)
            })
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
    if(data.length === 0) {
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
                Object.entries(data).slice(0, lbSize).map((entry, entryIdx) => {
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
                            <BoardLink name={name} url={url} linkUrl={linkUrl}/>
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