'use client';

import {useSearchParams} from "next/navigation";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import Box from "@mui/material/Box";
import { getDarkerColor } from "@/app/utils";

const setDays = (days: number, paramString: string) => {
    const params = new URLSearchParams(paramString)
    params.set("days", days.toString())
    window.location.href = "?" + params.toString()
}

export default function RangeChange() {
    const searchParams = useSearchParams()
    const paramString = searchParams.toString()
    const days = parseInt(searchParams.get('days') || '30')
    const colours = useContext(UserColoursContext)
    return <Box className="rangeButtons" sx={colours?.isCustom ?{
        '& button': {
            backgroundColor: `#${colours.fg}`,
            ...colours.fgText
        },
        '& button.btn-primary': {
            backgroundColor: `#${getDarkerColor(colours.fg, 0.8)}`,
            borderColor: `#000000`,
        },
        '& button:hover': {
            backgroundColor: `#${getDarkerColor(colours.fg, 0.9)}`,
            ...colours.bgText
        }
    } : {}}>
        <button className={"btn " + (days === 1 ? "btn-primary" : "btn-dark")}
                onClick={() => setDays(1, paramString)}>
            24 hours
        </button>
        <button className={"btn " + (days === 7 ? "btn-primary" : "btn-dark")}
                onClick={() => setDays(7, paramString)}>
            7 days
        </button>
        <button className={"btn " + (days === 30 ? "btn-primary" : "btn-dark")}
                onClick={() => setDays(30, paramString)}>
            30 days
        </button>
        <button className={"btn " + (days === 9999 ? "btn-primary" : "btn-dark")}
                onClick={() => setDays(9999, paramString)}>
            Lifetime
        </button>
    </Box>
}