'use client'

import {getEventTime, getLastSplit} from "@/app/utils";
import {useRouter} from "next/navigation";
import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then(r => r.json())

export async function LiveRuns() {
    const router = useRouter()

    const getRefreshInterval = () => {
        return 3000
    }

    const {data: ars} = useSWR(`https://paceman.gg/api/ars/liveruns`,
        fetcher, {refreshInterval: getRefreshInterval}
    )

    return <div className="liveRuns">
        <div className="liveHeader">
            <h3>Live runs</h3>
        </div>
        <table className="table table-dark">
            <tbody>
            {ars && ars.map((run: any) => {
                    //if (run.user.liveAccount === null) return null
                    const data = {
                        nether: getEventTime(run, "rsg.enter_nether", false),
                        bastion: getEventTime(run, "rsg.enter_bastion", false),
                        fortress: getEventTime(run, "rsg.enter_fortress", false),
                        first_portal: getEventTime(run, "rsg.first_portal", false),
                        stronghold: getEventTime(run, "rsg.enter_stronghold", false),
                        end: getEventTime(run, "rsg.enter_end", false),
                        finish: getEventTime(run, "rsg.finish", false),
                    }

                    const last = getLastSplit(data, true)
                    const url = `https://mc-heads.net/avatar/${run.nickname}/8`

                    return <tr key={run.worldId} onClick={() => {
                        router.push(`/run/${run.worldId}`)
                    }}>
                        <td><img className="avatar" src={url} alt={run.nickname}/><p>{run.nickname}</p></td>
                        <td>{last.full}</td>
                    </tr>
                }
            )}
            </tbody>
        </table>
    </div>
}