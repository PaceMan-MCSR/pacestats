'use client';

import {useEffect} from 'react';

export default function ResetScroll() {
    useEffect(() => {
        window.scroll(0, 0)
    }, [])
    return null
}