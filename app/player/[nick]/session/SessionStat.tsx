'use client'

import {CategoryType, formatTime} from "@/app/utils";
import {useState} from "react";

export function SessionStat({category, headUrl, name, hours, hoursBetween, data}: {
    category: string,
    headUrl: string,
    name: string,
    hours: number,
    hoursBetween: number,
    data: any
}) {
    const [focus, setFocus] = useState(false);

    return <div className="stat mb-4" onClick={() => {setFocus(!focus)}}>
        {!focus && (
            <h4 className="statHeader" style={{marginBottom: 10, userSelect: "none"}}>
                {category}
            </h4>
        )}
        {focus && (
            <div>
                <h4 className="statHeader" style={{marginBottom: 8, userSelect: "none"}}>
                    {category}
                    <div>
                        <p style={{marginTop: -30}}>Session</p>
                        <p style={{marginTop: 0}}>{hours}h/{hoursBetween}h</p>
                    </div>
                </h4>
                <h5 style={{marginTop: -20, marginBottom: 12, userSelect: "none"}}>
                    <img className="titleHead" style={{width: 24, marginLeft: 0}} src={headUrl} alt={name}/>
                    {name}
                </h5>
            </div>
        )}
        <p>Quantity: {data.count}</p>
        <p>Average: {data.avg}</p>
    </div>
}