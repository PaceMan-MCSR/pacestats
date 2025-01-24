import RunPage from "@/app/run/[worldid]/RunPage";
import {getCached, getWorld} from "@/app/data";
import {formatTime} from "@/app/utils";

export async function generateMetadata({params}: { params: { worldid: string } }) {
    const worldId = params.worldid
    const run = await getCached(getWorld, "getWorld", worldId)
    if(run === null) {
        return {
            title: 'Pace Stats',
            description: 'Unknown run',
            icons: {
                icon: [
                    '/stats/jojoe7sadpag.ico'
                ]
            }
        }
    }
    const splits = {
        nether: "Nether",
        bastion: "Bastion",
        fortress: "Fortress",
        first_portal: "First Portal",
        stronghold: "Stronghold",
        end: "End Enter",
        finish: "Completion"
    }

    let lastSplit = "nether"
    let msg = ""
    for(const split in splits){
        if(run.data[split] !== null){
            lastSplit = split
            // @ts-ignore
            msg += `${formatTime(run.data[split])} ${splits[split]}\n`
        }
    }

    // @ts-ignore
    const splitName = splits[lastSplit]
    const date = new Date(run.data.updateTime * 1000)

    // chatgpt wrote this
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const formattedDateTime = `${year}-${month}-${day} ${hours}:${minutes}`;

    let desc = `${formattedDateTime}${run.data.twitch ? `\nStreamed live at https://twitch.tv/${run.data.twitch}` : ""}\n${msg.trim()}`
    return {
        title: `${formatTime(run.data[lastSplit])} ${splitName} by ${run.data.nickname}`,
        description: desc,
        icons: {
            icon: [
                `https://mc-heads.net/avatar/${run.data.nickname}/8`
            ]
        }
    }
}

// wrap in server component so we can generate embed metadata
export default function Page({params}: {
    params: { worldid: string }
}) {
    return <RunPage params={params} />
}