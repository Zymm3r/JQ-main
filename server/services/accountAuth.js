const crypto = require('crypto');
const User = require('../models/User');
const Store = require('../models/Store');
require('../loadEnv');

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const fallbackSecret = crypto.randomBytes(32).toString('hex');
const tokenSecret = process.env.ADMIN_TOKEN_SECRET || fallbackSecret;

function signAccountToken(user) {
    const payload = Buffer.from(JSON.stringify({
        sub: user._id.toString(),
        role: user.role,
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyAccountToken(token) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) throw new Error('INVALID_TOKEN');
    const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
        throw new Error('INVALID_TOKEN');
    }
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!claims.sub || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('EXPIRED_TOKEN');
    return claims;
}

async function requireAccount(req, res, next) {
    try {
        const authorization = req.get('authorization') || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const claims = verifyAccountToken(token);
        const user = await User.findById(claims.sub);
        if (!user || user.status === 'suspended') return res.status(403).json({ error: 'Account is unavailable' });
        const store = await Store.findOne({ ownerId: user._id });
        req.account = user;
        req.accountStore = store;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Account authentication required' });
    }
}

function requireVerifiedAccount(req, res, next) {
    if (!req.account.emailVerified) return res.status(403).json({ error: 'Email verification required' });
    next();
}

function requirePlatformAdmin(req, res, next) {
    if (req.account.role !== 'platform_admin') return res.status(403).json({ error: 'Platform administrator required' });
    next();
}

module.exports = {
    signAccountToken,
    verifyAccountToken,
    requireAccount,
    requireVerifiedAccount,
    requirePlatformAdmin
};
