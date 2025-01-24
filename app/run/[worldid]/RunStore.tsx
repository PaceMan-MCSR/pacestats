import { create } from 'zustand'
import {TwitchPlayerInstance} from "react-twitch-embed";

interface RunState {
    data: any
    isLive: boolean
    isLoading: boolean
    dying: boolean
    vodEmbed: TwitchPlayerInstance | undefined
    liveEmbed: TwitchPlayerInstance | undefined
}

export const useRunStore = create<RunState>()(() => ({
    data: undefined,
    isLive: false,
    isLoading: true,
    dying: false,
    vodEmbed: undefined,
    liveEmbed: undefined,
}))