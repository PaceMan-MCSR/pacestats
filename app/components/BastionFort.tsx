'use client';

import { useRouter, useSearchParams } from "next/navigation";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import { colourVars, customClass } from "@/app/components/customColours";

export default function BastionFort({bastionFort: controlledBastionFort, setBastionFort}: {
    bastionFort?: boolean,
    setBastionFort?: (value: boolean) => void,
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
                router.push("?" + params.toString(), {scroll: false})
            }}
        >{bastionFort ? "First/Second Structure" : "Bastion/Fortress"}
        </button>
    </div>
}
