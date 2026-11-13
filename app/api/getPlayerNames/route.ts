import { getAllUsers, getCached } from "@/app/data";
import {jsonResponse} from "@/app/api/_utils";

type User = {nick: string, twitches?: string[]};

// The search box's player list: names and Twitch handles only. Each entry is
// a nick, or [nick, ...twitchHandles] for players with linked accounts.
// /api/getAllUsers/ carries UUIDs and colours as well and is over three times
// the size on the wire; the search box asks /api/getPlayerInfo/ for those,
// for the few players it shows.
export async function GET() {
    const users = await getCached(getAllUsers, "getAllUsers") as User[];
    const names = users.map((user) =>
        user.twitches && user.twitches.length > 0 ? [user.nick, ...user.twitches] : user.nick
    );
    return jsonResponse(names, {cacheSeconds: 600, staleSeconds: 1_800});
}
