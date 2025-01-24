export interface Entry {
    uuid: string,
    name: string,
    value: number,
    qty: number,
    avg: number
}

export interface FastestEntry {
    uuid: string,
    name: string,
    value: number,
    runId: number
}

export interface Bustable {
    time: number,
    cachePeriod: number,
    data: any
}

export interface Twitch {
    twitch: string,
    time: number
}

export interface SearchName {
    id: string,
    nick: string,
    twitches: string[]
}