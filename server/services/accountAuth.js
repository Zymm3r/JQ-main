const crypto = require('crypto');
const User = require('../models/User');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const { effectivePermissions } = require('./memberPermissions');
const { isPlatformRole, isStoreRole, platformPermissions } = require('./platformPermissions');
const PlatformAudit = require('../models/PlatformAudit');
require('../loadEnv');

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const fallbackSecret = crypto.randomBytes(32).toString('hex');
const tokenSecret = process.env.ADMIN_TOKEN_SECRET || fallbackSecret;

function signAccountToken(user, store = null, options = {}) {
    const payload = Buffer.from(JSON.stringify({
        sub: user._id.toString(),
        role: user.role,
        storeId: store?.storeId || null,
        ...(options.impersonationAuditId ? { impersonationAuditId: String(options.impersonationAuditId) } : {}),
        exp: Math.floor(Date.now() / 1000) + (options.ttlSeconds || TOKEN_TTL_SECONDS)
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
        let store = null;
        let membership = null;
        if (isStoreRole(user.role)) {
            if (!claims.storeId) return res.status(403).json({ error: 'Token is not assigned to a merchant store' });
            store = await Store.findOne({ storeId: claims.storeId });
            membership = await StoreMember.findOne({ storeId: claims.storeId, userId: user._id });
            if (!membership && store?.ownerId?.equals(user._id)) {
                membership = { role: 'owner', permissions: [], status: 'active' };
            }
            if (!store || !membership || membership.status !== 'active') {
                return res.status(403).json({ error: 'Store membership is unavailable' });
            }
        } else if (isPlatformRole(user.role) && claims.impersonationAuditId && claims.storeId) {
            const [impersonationAudit, impersonatedStore] = await Promise.all([
                PlatformAudit.findOne({ _id: claims.impersonationAuditId, actorUserId: user._id, storeId: claims.storeId, action: 'store.impersonate' }).lean(),
                Store.findOne({ storeId: claims.storeId })
            ]);
            if (!impersonationAudit || !impersonatedStore) return res.status(403).json({ error: 'Impersonation audit is unavailable' });
            store = impersonatedStore;
            membership = { role: 'platform_impersonation', permissions: ['queue.call', 'queue.seat', 'queue.complete', 'queue.cancel', 'session.reset', 'settings.update'], status: 'active' };
        } else if (isPlatformRole(user.role) && claims.storeId) {
            return res.status(403).json({ error: 'Platform accounts require audited impersonation' });
        }
        req.account = user;
        req.accountStore = store;
        req.auth = {
            userId: user._id.toString(),
            role: user.role,
            storeId: claims.storeId || null,
            memberRole: membership?.role || null,
            permissions: membership ? effectivePermissions(membership) : [],
            platformPermissions: platformPermissions(user.role),
            isImpersonating: Boolean(claims.impersonationAuditId),
            impersonationAuditId: claims.impersonationAuditId || null
        };
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
    if (!isPlatformRole(req.account.role) || req.auth.isImpersonating) return res.status(403).json({ error: 'Platform account required' });
    next();
}

function signImpersonationToken(user, store, auditId) {
    return signAccountToken(user, store, { impersonationAuditId: auditId, ttlSeconds: 30 * 60 });
}

module.exports = {
    signAccountToken,
    signImpersonationToken,
    verifyAccountToken,
    requireAccount,
    requireVerifiedAccount,
    requirePlatformAdmin
};
