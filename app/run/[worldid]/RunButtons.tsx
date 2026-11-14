'use client'

import {useRunStore} from "@/app/run/[worldid]/RunStore";
import {useState} from "react";
import {formatTime} from "@/app/utils";

export default function RunButtons() {
    const [clipboard, setClipboard] = useState("")
    const data = useRunStore(state => state.data);

    const setClipboardUrl = (url: string) => {
        navigator.clipboard.writeText(url);
        setClipboard(url)
    }

    const getUrl = () => {
        return `${window.location.origin}/stats/run/${data.id}/`
    }

    const getSplits = () => {
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
        navigator.clipboard.writeText(getUrl());
        setClipboard("url");
    }

    return (
        <div className="runButtons">
            <button onClick={copySplits} className="btn btn-primary copy-splits">{getSplits() === clipboard ? "Copied!" : "Copy Splits"}</button>
            <button onClick={copyUrl} className="btn btn-primary copy-url">{clipboard === "url" ? "Copied!" : "Copy Link"}</button>
        </div>
    )
}
