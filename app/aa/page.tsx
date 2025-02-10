import { getAllUserInfo, getCached, getTrimmedAALB } from "@/app/data";
import AAPage from "@/app/aa/AAPage";

export default async function Page({searchParams}: { searchParams: { [key: string]: string | undefined } }) {
    let days: number = parseInt(searchParams["days"] || "30")
    const lb = await getCached(getTrimmedAALB, "getTrimmedAALB", days, 10, false);
    const users = await getCached(getAllUserInfo, "getAllUserInfo");
    return <AAPage searchParams={searchParams} lb={lb} users={users}/>
}