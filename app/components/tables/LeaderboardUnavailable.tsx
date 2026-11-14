'use client';

import {useRouter} from 'next/navigation';
import {useTransition} from 'react';

export default function LeaderboardUnavailable() {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    return <div className="text-center mb-4" role="status" aria-busy={pending}>
        <p>Leaderboard data is temporarily unavailable. Please try again shortly.</p>
        <button
            type="button"
            className="btn btn-dark"
            disabled={pending}
            onClick={() => startTransition(() => router.refresh())}
        >{pending ? 'Retrying…' : 'Retry leaderboards'}</button>
    </div>;
}
