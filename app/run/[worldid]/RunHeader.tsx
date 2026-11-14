'use client'

import {useRunStore} from "@/app/run/[worldid]/RunStore";
import {getLastSplit} from "@/app/utils";

export default function RunHeader() {
    const data = useRunStore(state => state.data)
    const dying = useRunStore(state => state.dying)

    const isLive = useRunStore(state => state.isLive);
    return <div className="runHeader">
        <h1 className="header">{getLastSplit(data).full}</h1>
        {isLive && !dying && (
            <div className="row justify-content-center">
                <div className="col-12 last-updated">
                    <p className="live-text">
                        Run is updating live
                    </p>
                </div>
            </div>
        )}
        {(dying || !isLive) && (
            <div className="row justify-content-center">
                <div className="col-12 last-updated">
                    <p className="reset-text">
                        
                    </p>
                </div>
            </div>
        )}
        </div>
}
