'use client';

import {useRouter, useSearchParams} from "next/navigation";
import { useEffect, useState } from "react";

export default function ToggleQty({showSample, setShowSample} : {showSample: boolean, setShowSample: any}) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const paramString = searchParams.toString()
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(false);
    }, []);

    return <button
            className={"btn btn-dark"}
            type="button"
            disabled={isLoading}
            onClick={() => {
                const params = new URLSearchParams(paramString)
                if(showSample) {
                    params.delete("showQty")
                } else {
                    params.set("showQty", "true")
                }
                setShowSample(!showSample)
                router.push("?" + params.toString(), {scroll: false})
            }}
        >{showSample ? "Hide" : "Show"} Sample Sizes
    </button>
}