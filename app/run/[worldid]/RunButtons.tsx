'use client'

import {useRunStore} from "@/app/run/[worldid]/RunStore";
import {useState} from "react";
import {formatTime} from "@/app/utils";

const splitLabels = [
    ['nether', 'Nether'], ['bastion', 'Bastion'], ['fortress', 'Fortress'],
    ['first_portal', 'First Portal'], ['stronghold', 'Stronghold'], ['end', 'End'], ['finish', 'Finish'],
] as const;
function getSplitText(data: any) {
    if (!data) return '';
    let text = '';
    for (const [split, label] of splitLabels) {
        if (data[split] !== null) text += `${formatTime(data[split])} ${label}\n`;
    }
    return text.trim();
}

export default function RunButtons() {
    const [clipboard, setClipboard] = useState("")
    const runId = useRunStore(state => state.data?.id);
    const splitText = useRunStore(state => getSplitText(state.data));

    const setClipboardUrl = (url: string) => {
        navigator.clipboard.writeText(url);
        setClipboard(url)
    }

    const getUrl = () => {
        return `${window.location.origin}/stats/run/${runId}/`
    }

    const copySplits = () => {
        setClipboardUrl(splitText)
    }

    const copyUrl = () => {
        navigator.clipboard.writeText(getUrl());
        setClipboard("url");
    }

    return (
        <div className="runButtons">
            <button onClick={copySplits} className="btn btn-primary copy-splits">{splitText === clipboard ? "Copied!" : "Copy Splits"}</button>
            <button onClick={copyUrl} className="btn btn-primary copy-url">{clipboard === "url" ? "Copied!" : "Copy Link"}</button>
        </div>
    )
}
