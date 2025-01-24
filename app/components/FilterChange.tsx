'use client';

import {useSearchParams} from "next/navigation";
import {useState} from "react";
import {Collapse} from "react-bootstrap";

const changeCategory = (category: string, paramString: string) => {
    const params = new URLSearchParams(paramString)
    params.set('category', category)
    window.location.href = "?" + params.toString()
}

export default function FilterChange() {
    const searchParams = useSearchParams()
    const paramString = searchParams.toString()
    const input = searchParams.get('category')
    const [toggled, setToggled] = useState(input !== null);
    let category = "count_avg"
    if (input === "fastest") {
        category = "fastest"
    } else if (input === "conversion") {
        category = "conversion"
    } else if (input === "average"){
        category = "average"
    }
    return <div className="filterGroup">
        <button
            className={"btn btn-dark filterToggle" + (toggled ? " active" : "")}
            type="button"
            onClick={() => {
                setToggled(!toggled)
            }}
        >Toggle category
        </button>
        <Collapse in={toggled}>
            <div className="filterButtons" id="filterButtons">
                <button className={"btn mt-3 " + (category === "count_avg" ? "btn-primary" : "btn-dark")}
                        onClick={() => changeCategory("count_avg", paramString)}>
                    Qty + Average
                </button>
                <br/>
                <button className={"btn my-3 mx-1 " + (category === "conversion" ? "btn-primary" : "btn-dark")}
                        onClick={() => changeCategory("conversion", paramString)}>
                    Conversion
                </button>
                <button className={"btn my-3 mx-1 " + (category === "fastest" ? "btn-primary" : "btn-dark")}
                        onClick={() => changeCategory("fastest", paramString)}>
                    Fastest
                </button>
                <button className={"btn my-3 mx-1 " + (category === "average" ? "btn-primary" : "btn-dark")}
                        onClick={() => changeCategory("average", paramString)}>
                    Average
                </button>
            </div>
        </Collapse>

    </div>
}