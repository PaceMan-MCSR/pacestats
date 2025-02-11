import { createContext } from 'react';

export const UsersContext = createContext([] as {
    uuid: string,
    displayName: string,
    color: string,
}[]);

export const UserColoursContext = createContext({isCustom: false} as {
    bg: string,
    fg: string,
    bgText: {},
    fgText: {},
    name: string,
    isCustom: boolean,
});