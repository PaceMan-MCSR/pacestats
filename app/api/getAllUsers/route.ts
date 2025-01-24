import {NextRequest, NextResponse} from "next/server";
import { getAllUsers, getCached } from "@/app/data";

export async function GET(request: NextRequest) {
    const names = await getCached(getAllUsers, "getAllUsers");
    return NextResponse.json(names, { status: 200 });
}