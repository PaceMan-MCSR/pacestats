import RelativeTimer from "@/app/components/profile/RelativeTimer";
import { useContext } from "react";
import { UserColoursContext } from "@/app/contexts";
import { getDarkerColor } from "@/app/utils";

export function TwitchEntry({twitch}: { twitch: { twitch: string, time: number, live: boolean } }) {
    const name = twitch.twitch
    const lastLive = twitch.time
    const isLive = twitch.live
    const colours = useContext(UserColoursContext)
    return <div className="twitch" style={colours.isCustom ? {
        backgroundColor: `#${colours.fg}`,
        filter: `drop-shadow(0 0 2px #${getDarkerColor(colours.bg, 0.5)})`,
    } : {}}>
        <a href={"https://twitch.tv/" + name} style={{
            color: `#${colours.name}`,
            filter: `drop-shadow(0 0 3px #000) drop-shadow(0 0 2px #000)`,
        }}>{name}</a>
        {isLive ?
            <div>
                <a href={"https://twitch.tv/" + name}>
                    <p className="liveNow">
                        Live now<br/>Last nether: <RelativeTimer start={lastLive}/>
                    </p>
                    <img className="thumb"
                         src={"https://static-cdn.jtvnw.net/previews-ttv/live_user_" + name + "-320x180.jpg"}
                         alt={name}/>
                </a>
            </div>
            :
            <div>
                <p style={colours.isCustom ? {
                    ...colours.fgText,
                } : {}}>Last live playing RSG:<br/> <RelativeTimer start={lastLive}/></p>
            </div>}
    </div>
}