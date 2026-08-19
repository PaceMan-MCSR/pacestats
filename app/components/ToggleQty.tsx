'use client';

import {useRouter, useSearchParams} from "next/navigation";

export default function ToggleQty({showSample: controlledShowSample, setShowSample}: {
    showSample?: boolean,
    setShowSample?: (value: boolean) => void,
} = {}) {
    const searchParams = useSearchParams()
    const router = useRouter()
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
                router.push("?" + params.toString(), {scroll: false})
            }}
        >{showSample ? "Hide" : "Show"} Sample Sizes
    </button>
}
