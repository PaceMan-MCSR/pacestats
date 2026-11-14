'use client';

import {useSearchParams} from "next/navigation";

export default function ToggleQty({showSample: controlledShowSample, setShowSample}: {
    showSample?: boolean,
    setShowSample?: (value: boolean) => void,
} = {}) {
    const searchParams = useSearchParams()
    const paramString = searchParams.toString()
    const showSample = controlledShowSample ?? searchParams.get("showQty") === "true"
    return <button
            className={"btn btn-dark"}
            type="button"
            onClick={() => {
                const params = new URLSearchParams(paramString)
                if(showSample) {
                    params.delete("showQty")
                } else {
                    params.set("showQty", "true")
                }
                setShowSample?.(!showSample)
                // Every selected table already has the sample counts. Next
                // integrates native history updates with useSearchParams,
                // including Back/Forward, without another server render.
                const query = params.toString()
                window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`)
            }}
        >{showSample ? "Hide" : "Show"} Sample Sizes
    </button>
}
