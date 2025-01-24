'use client'

function backToPaceMan() {
    if(window.location.pathname.indexOf("/stats/player/") === -1){
        window.location.href = "https://paceman.gg/";
        return
    }
    window.location.href = window.location.href.replace("/stats/player/", "/user/");
}

export default function PaceManLink() {
    return <a className="nav-link" href="#" onClick={backToPaceMan}>Back to PaceMan</a>;
}
