'use client';

import {createContext, useContext, useState} from 'react';
import type {ReactNode} from 'react';
import {createStore} from 'zustand/vanilla';
import {useStore} from 'zustand';
import type {TwitchPlayerInstance} from "react-twitch-embed";

export type WorldSnapshot = {
    data: any;
    isLive?: boolean;
    liveStatusUnknown?: boolean;
    time?: number;
} | null;

interface RunState {
    data: any
    isLive: boolean
    isLoading: boolean
    dying: boolean
    vodEmbed: TwitchPlayerInstance | undefined
    liveEmbed: TwitchPlayerInstance | undefined
}

const createRunStore = (initialWorld: WorldSnapshot) => createStore<RunState>()(() => ({
    data: initialWorld?.data ?? null,
    isLive: Boolean(initialWorld?.isLive),
    isLoading: false,
    dying: false,
    vodEmbed: undefined,
    liveEmbed: undefined,
}));

const RunStoreContext = createContext<ReturnType<typeof createRunStore> | null>(null);

// Each rendered route owns its state. This both seeds server-rendered splits
// and prevents one visitor or previously opened run from supplying stale data.
export function RunStoreProvider({initialWorld, children}: {initialWorld: WorldSnapshot, children: ReactNode}) {
    const [store] = useState(() => createRunStore(initialWorld));
    return <RunStoreContext.Provider value={store}>{children}</RunStoreContext.Provider>;
}

export function useRunStoreApi() {
    const store = useContext(RunStoreContext);
    if (!store) throw new Error('Run store is missing its provider');
    return store;
}

export function useRunStore<T>(selector: (state: RunState) => T): T {
    return useStore(useRunStoreApi(), selector);
}
