'use client';

import {useRouter, useSearchParams} from "next/navigation";

export default function BastionFort({bastionFort, setBastionFort} : {bastionFort: boolean, setBastionFort: any}) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const paramString = searchParams.toString()
    return <button
            className={"btn btn-dark"}
            type="button"
            onClick={() => {
                const params = new URLSearchParams(paramString)
                if(bastionFort) {
                    params.delete("bastionFort")
                } else {
                    params.set("bastionFort", "true")
                }
                setBastionFort(!bastionFort)
                router.push("?" + params.toString(), {scroll: false})
            }}
        >{bastionFort ? "First/Second Structure" : "Bastion/Fortress"}
    </button>
}