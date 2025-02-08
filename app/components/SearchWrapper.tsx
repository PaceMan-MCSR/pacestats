import PlayerSearch from "@/app/components/PlayerSearch";
import {getAllUsers, getCached} from "@/app/data";

export default async function SearchWrapper() {
    const data = await getCached(getAllUsers, "getAllUsers");

    return <div className="searchWrapper">
        <PlayerSearch data={data}/>
    </div>
}