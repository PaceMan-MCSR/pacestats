import ObsWrapper from "@/app/obs/ObsWrapper";
import { getAllUserInfo, getCached } from "@/app/data";

export const dynamic = "force-dynamic"

export default async function Page(
    props: {
        params: Promise<{ worldid: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const params = await props.params;
    // The search box loads the player list itself on first use; embedding it
    // here added over half a megabyte to this page's HTML.
    const userInfo = await getCached(getAllUserInfo, "getAllUserInfo");
    return <ObsWrapper userInfo={userInfo} params={params} />
}