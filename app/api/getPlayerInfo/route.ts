import {NextRequest} from "next/server";
import { getAllUsers, getCached } from "@/app/data";
import {
    ApiInputError,
    jsonResponse,
    rateLimit,
    stringParam,
    validationErrorResponse,
} from "@/app/api/_utils";

type User = {
    id: string,
    nick: string,
    displayName?: string | null,
    color?: string | null,
    bgColor?: string | null,
};

const MAX_NAMES = 20;

let indexedUsers: User[] | undefined;
let usersByNick = new Map<string, User>();

// UUID, display name and colours for up to 20 players, keyed by the
// lower-cased nick that was asked for. Unknown names map to null.
export async function GET(request: NextRequest) {
    const limited = rateLimit(request, {namespace: "getPlayerInfo", limit: 240, windowMs: 60_000});
    if (limited) return limited;
    try {
        const raw = stringParam(request.nextUrl.searchParams, "names", {required: true, maxLength: 800});
        const names = [...new Set(raw.split(",").map((name) => name.trim().toLocaleLowerCase()).filter(Boolean))];
        if (names.length > MAX_NAMES) throw new ApiInputError(`names must list at most ${MAX_NAMES} players`);

        const users = await getCached(getAllUsers, "getAllUsers") as User[];
        // getCached returns the same array until its entry expires, so the
        // index is rebuilt only when the list changes.
        if (users !== indexedUsers) {
            usersByNick = new Map(users.map((user) => [user.nick.toLocaleLowerCase(), user]));
            indexedUsers = users;
        }

        const result: Record<string, object | null> = {};
        for (const name of names) {
            const user = usersByNick.get(name);
            result[name] = user ? {
                id: user.id,
                nick: user.nick,
                displayName: user.displayName ?? null,
                color: user.color ?? null,
                bgColor: user.bgColor ?? null,
            } : null;
        }
        return jsonResponse(result, {cacheSeconds: 300, staleSeconds: 900});
    } catch (error) {
        const invalid = validationErrorResponse(error);
        if (invalid) return invalid;
        throw error;
    }
}
