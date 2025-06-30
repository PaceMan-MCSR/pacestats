'use client';

import { useRouter, useSearchParams } from "next/navigation";
import { useContext, useEffect, useState } from "react";
import { UserColoursContext } from "@/app/contexts";
import Box from "@mui/material/Box";
import { getDarkerColor } from "@/app/utils";

export default function BastionFort({bastionFort, setBastionFort}: { bastionFort: boolean, setBastionFort: any }) {
    const searchParams = useSearchParams()
    const router = useRouter()
    const paramString = searchParams.toString()
    const colours = useContext(UserColoursContext)
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(false);
    }, []);

    return <Box sx={colours?.isCustom ?{
        '& button': {
            backgroundColor: `#${colours.fg}`,
            ...colours.fgText
        },
        '& button:hover': {
            backgroundColor: `#${getDarkerColor(colours.fg, 0.9)} !important`,
            ...colours.bgText
        }
    } : {}}>
        <button
            className={"btn btn-dark"}
            type="button"
            style={colours?.isCustom ? {
                backgroundColor: `#${colours.fg}`,
                ...colours.fgText
            } : {}}
            disabled={isLoading}
            onClick={() => {
                const params = new URLSearchParams(paramString)
                if (bastionFort) {
                    params.delete("bastionFort")
                } else {
                    params.set("bastionFort", "true")
                }
                setBastionFort(!bastionFort)
                router.push("?" + params.toString(), {scroll: false})
            }}
        >{bastionFort ? "First/Second Structure" : "Bastion/Fortress"}
        </button>
    </Box>
}