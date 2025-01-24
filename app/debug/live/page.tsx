'use client'

import {LiveRuns} from "@/app/components/LiveRuns";

export default function Page() {

    return <div className="container">
        <div className="row justify-content-center mt-4">
            <div className="col-4">
                <LiveRuns />
            </div>
        </div>
    </div>
}