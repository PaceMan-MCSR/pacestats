import { createContext } from 'react';

export const UsersContext = createContext([] as {
    uuid: string,
    displayName: string,
    color: string,
}[]);