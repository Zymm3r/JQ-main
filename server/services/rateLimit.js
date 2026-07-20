function createRateLimiter({ windowMs, max, key = req => req.ip }) {
    const attempts = new Map();
    return (req, res, next) => {
        const now = Date.now();
        if (attempts.size > 10_000) {
            for (const [entryKey, entry] of attempts) if (entry.resetAt <= now) attempts.delete(entryKey);
        }
        const entryKey = key(req);
        const current = attempts.get(entryKey);
        const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
        entry.count += 1;
        attempts.set(entryKey, entry);
        res.set('RateLimit-Limit', String(max));
        res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
        if (entry.count > max) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        next();
    };
}

module.exports = { createRateLimiter };
