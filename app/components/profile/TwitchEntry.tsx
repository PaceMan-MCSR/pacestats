import RelativeTimer from "@/app/components/profile/RelativeTimer";

export async function TwitchEntry({twitch}: { twitch: { twitch: string, time: number, live: boolean } }) {
    const name = twitch.twitch
    const lastLive = twitch.time
    const isLive = twitch.live
    return <div className="twitch">
        <a href={"https://twitch.tv/" + name}>{name}</a>
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
                <p>Last live playing RSG:<br/> <RelativeTimer start={lastLive}/></p>
            </div>}
    </div>
}