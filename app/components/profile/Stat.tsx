'use client'

import {CategoryType, formatTime} from "@/app/utils";
import {useState} from "react";

export function Stat({category, headUrl, name, days, data}: {
    category: string,
    headUrl: string,
    name: string,
    days: number,
    data: {[filter: number] : {ranking: number, value: number}}
}) {
    const [focus, setFocus] = useState(false);

    let count = data[CategoryType.COUNT]
    let avg = data[CategoryType.AVG]
    let fastest = data[CategoryType.FASTEST]
    let conversion = data[CategoryType.CONVERSION]
    if(count === undefined){
        return null;
    }
    return <div className="stat mb-4" onClick={() => {setFocus(!focus)}}>
        {!focus && (
            <h4 className="statHeader" style={{marginBottom: 10, userSelect: "none"}}>
                {category}
            </h4>
        )}
        {focus && (
            <div>
                <h4 className="statHeader" style={{marginBottom: 8, userSelect: "none"}}>
                    {category} <div><p>{days === 9999 ? "Lifetime" : days + "d"}</p></div>
                </h4>
                <h5 style={{marginBottom: 12, userSelect: "none"}}>
                    <img className="titleHead" style={{width: 24, marginLeft: 0}} src={headUrl} alt={name}/>
                    {name}
                </h5>
            </div>
        )}
        <p>Quantity: {count.value} {count.ranking !== -1 ? ("(#" + count.ranking + ")") : ""}</p>
        <p>Average: {formatTime(avg.value, false)} {avg.ranking !== -1 ? ("(#" + avg.ranking + ")") : ""}</p>
        <p>Fastest: {formatTime(fastest.value)} {fastest.ranking !== -1 ? ("(#" + fastest.ranking + ")") : ""}</p>
        {conversion !== undefined && (
            <p>Conversion: {conversion.value.toFixed(1)}% {conversion.ranking !== -1 ? ("(#" + conversion.ranking + ")") : ""}</p>
        )}
    </div>
}