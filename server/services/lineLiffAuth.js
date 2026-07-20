async function resolveLineIdentity(req) {
    const accessToken = String(req.get('x-line-access-token') || '').trim();
    if (!accessToken) {
        if (process.env.NODE_ENV === 'production' && process.env.LINE_LIFF_ID) {
            const error = new Error('LINE_LOGIN_REQUIRED');
            error.statusCode = 401;
            throw error;
        }
        return { lineUserId: null, displayName: null };
    }

    const response = await fetch('https://api.line.me/v2/profile', {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
        const error = new Error('INVALID_LINE_SESSION');
        error.statusCode = 401;
        throw error;
    }
    const profile = await response.json();
    return { lineUserId: profile.userId, displayName: profile.displayName || null };
}

module.exports = { resolveLineIdentity };
