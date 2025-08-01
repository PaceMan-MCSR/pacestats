import ObsWrapper from "@/app/obs/ObsWrapper";
import { getAllUserInfo, getAllUsers, getCached } from "@/app/data";

export const dynamic = "force-dynamic"

export default async function Page(
    props: {
        params: Promise<{ worldid: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const params = await props.params;
    const names = await getCached(getAllUsers, "getAllUsers");
    const userInfo = await getCached(getAllUserInfo, "getAllUserInfo");
    return <ObsWrapper names={names} userInfo={userInfo} params={params} />
}