'use client'

import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";

function backToPaceMan() {
    if(window.location.pathname.indexOf("/stats/player/") === -1){
        window.location.href = "https://paceman.gg/";
        return
    }
    window.location.href = window.location.href.replace("/stats/player/", "/user/");
}

export default function PaceManLink() {
    const colours = useContext(UserColoursContext)
    return <a className="nav-link" href="#" onClick={backToPaceMan} style={colours.fgText}>Back to PaceMan</a>;
}
