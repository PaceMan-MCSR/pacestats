'use client'

import ResetScroll from "@/app/components/ResetScroll";
import useSWR from "swr";
import {useRouter} from "next/navigation";
import {formatTime, getLastSplit} from "@/app/utils";
import RelativeTimer from "@/app/components/profile/RelativeTimer";

const fetcher = (url: string) => fetch(url).then(r => r.json())


export default function Page() {
    const router = useRouter()

    const getRefreshInterval = () => {
        return 3000
    }

    const { data: ars } = useSWR(`https://paceman.gg/api/ars/liveruns`,
        fetcher, { refreshInterval: getRefreshInterval }
    )

    const getEventTime = (run: any, eventName: string, rta: boolean = false) => {
        const evt = run.eventList.find((e: any) => e.eventId === eventName)
        if(!evt){
            return null
        }
        return rta ? evt.rta : evt.igt
    }

    return <main className="main debug">
        <div className="container">
            <ResetScroll />
            <div className="row justify-content-center">
                <div className="col-lg-8 col-xl-7">
                    <table className="table table-dark">
                        <thead>
                            <tr>
                                <th scope="col">Split</th>
                                <th scope="col">Nickname</th>
                                <th scope="col">Twitch</th>
                                <th scope="col">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ars && ars.map((run: any) => {
                                if(run.user.liveAccount === null) return null
                                const data = {
                                    nether: getEventTime(run, "rsg.enter_nether", false),
                                    bastion: getEventTime(run, "rsg.enter_bastion", false),
                                    fortress: getEventTime(run, "rsg.enter_fortress", false),
                                    first_portal: getEventTime(run, "rsg.first_portal", false),
                                    stronghold: getEventTime(run, "rsg.enter_stronghold", false),
                                    end: getEventTime(run, "rsg.enter_end", false),
                                    finish: getEventTime(run, "rsg.finish", false),
                                }

                                const last = getLastSplit(data, false)

                                return <tr key={run.worldId} onClick={() => {router.push(`/run/${run.worldId}`)}}>
                                    <td>{`${last.full}`}</td>
                                    <td>{run.nickname}</td>
                                    <td>{run.user.liveAccount}</td>
                                    <td><RelativeTimer start={run.lastUpdated / 1000}/></td>
                                </tr>
                            }
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </main>
}