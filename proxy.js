import { NextResponse } from 'next/server';

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 5;

// In-memory store — works for single-instance / dev; replace with Redis for multi-instance prod.
const store = new Map();

function getClient(ip) {
    const now = Date.now();
    const entry = store.get(ip);

    if (!entry || now >= entry.resetAt) {
        const fresh = { count: 1, resetAt: now + WINDOW_MS };
        store.set(ip, fresh);
        return fresh;
    }

    entry.count += 1;
    return entry;
}

export function proxy(request) {
    const ip =
        request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
        request.headers.get('x-real-ip') ??
        '127.0.0.1';

    const client = getClient(ip);

    if (client.count > MAX_REQUESTS) {
        const retryAfter = Math.ceil((client.resetAt - Date.now()) / 1000);
        return new NextResponse(
            JSON.stringify({ error: `Rate limit exceeded. Try again in ${retryAfter}s.` }),
            {
                status: 429,
                headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(retryAfter),
                    'X-RateLimit-Limit': String(MAX_REQUESTS),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(Math.ceil(client.resetAt / 1000)),
                },
            }
        );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Limit', String(MAX_REQUESTS));
    response.headers.set('X-RateLimit-Remaining', String(MAX_REQUESTS - client.count));
    return response;
}

export const config = {
    matcher: '/api/getBestAnswer',
};
