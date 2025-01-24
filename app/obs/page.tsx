import ObsWrapper from "@/app/obs/ObsWrapper";
import {getAllUsers, getCached} from "@/app/data";

export const dynamic = "force-dynamic"

export default async function Page({params, searchParams}: {
    params: { worldid: string },
    searchParams: { [key: string]: string | undefined }
}) {
    const names = await getCached(getAllUsers, "getAllUsers");
    return <ObsWrapper names={names} params={params} />
}