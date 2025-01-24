'use client'

import {useRunStore} from "@/app/run/[worldid]/RunStore";
import {useState} from "react";
import {formatTime} from "@/app/utils";

export default function RunButtons() {
    const [clipboard, setClipboard] = useState("")

    const setClipboardUrl = (url: string) => {
        navigator.clipboard.writeText(url);
        setClipboard(url)
    }

    const getUrl = () => {
        return `${window.location.origin}/stats/run/${useRunStore.getState().data.id}/`
    }

    const getSplits = () => {
        const data = useRunStore.getState().data

        const splits = {
            nether: "Nether",
            bastion: "Bastion",
            fortress: "Fortress",
            first_portal: "First Portal",
            stronghold: "Stronghold",
            end: "End",
            finish: "Finish"
        }

        let msg = ""
        for(const split in splits){
            if(data[split] !== null){
                // @ts-ignore
                msg += `${formatTime(data[split])} ${splits[split]}\n`
            }
        }
        return msg.trim()
    }

    const copySplits = () => {
        setClipboardUrl(getSplits())
    }

    const copyUrl = () => {
        setClipboardUrl(getUrl())
    }

    return (
        <div className="runButtons">
            <button onClick={copySplits} className="btn btn-primary copy-splits">{getSplits() === clipboard ? "Copied!" : "Copy Splits"}</button>
            <button onClick={copyUrl} className="btn btn-primary copy-url">{getUrl() === clipboard ? "Copied!" : "Copy Link"}</button>
        </div>
    )
}