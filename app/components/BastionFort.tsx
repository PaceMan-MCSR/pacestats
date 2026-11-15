'use client';

import { useRouter, useSearchParams } from "next/navigation";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import { colourVars, customClass } from "@/app/components/customColours";

export default function BastionFort({bastionFort: controlledBastionFort, setBastionFort, navigate = true}: {
    bastionFort?: boolean,
    setBastionFort?: (value: boolean) => void,
    /** Pages that already hold both views can change the URL without a fetch. */
    navigate?: boolean,
} = {}) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const paramString = searchParams.toString()
    const bastionFort = controlledBastionFort ?? searchParams.get("bastionFort") === "true"
    const colours = useContext(UserColoursContext)
    return <div className={customClass(colours, "ccButtons")} style={colourVars(colours)}>
        <button
            className={"btn btn-dark"}
            type="button"
            style={colours?.isCustom ? {
                backgroundColor: `#${colours.fg}`,
                ...colours.fgText
            } : {}}
            onClick={() => {
                const params = new URLSearchParams(paramString)
                if (bastionFort) {
                    params.delete("bastionFort")
                } else {
                    params.set("bastionFort", "true")
                }
                setBastionFort?.(!bastionFort)
                if (navigate) {
                    router.push("?" + params.toString(), {scroll: false})
                } else {
                    const query = params.toString()
                    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`)
                }
            }}
        >{bastionFort ? "First/Second Structure" : "Bastion/Fortress"}
        </button>
    </div>
}
