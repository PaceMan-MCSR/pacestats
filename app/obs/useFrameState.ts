'use client';

import {useEffect, useMemo, useState} from 'react';
import {frameValue} from './frameValue';

export function useFrameState<T>(initial: T) {
    const [value, setValue] = useState(initial);
    const updater = useMemo(() => frameValue<T>(setValue), []);
    useEffect(() => () => updater.cancel(), [updater]);
    return [value, updater] as const;
}
