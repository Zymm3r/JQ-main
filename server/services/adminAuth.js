const crypto = require('crypto');
const { promisify } = require('util');
const Setting = require('../models/Setting');
const { normalizeStoreId } = require('../config');

const scrypt = promisify(crypto.scrypt);
const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const runtimeSecret = crypto.randomBytes(32).toString('hex');
const tokenSecret = process.env.ADMIN_TOKEN_SECRET || runtimeSecret;

if (!process.env.ADMIN_TOKEN_SECRET) {
    console.warn('ADMIN_TOKEN_SECRET is not set; admin sessions will be invalidated when the server restarts.');
}

async function hashPin(pin) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scrypt(String(pin), salt, 64);
    return `scrypt$${salt}$${derived.toString('hex')}`;
}

async function verifyPin(pin, encodedHash) {
    const [algorithm, salt, expectedHex] = String(encodedHash || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;
    const actual = await scrypt(String(pin), salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function signToken(storeId) {
    const payload = Buffer.from(JSON.stringify({
        storeId,
        role: 'admin',
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function verifyToken(token) {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) throw new Error('INVALID_TOKEN');
    const expected = crypto.createHmac('sha256', tokenSecret).update(payload).digest('base64url');
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) throw new Error('INVALID_TOKEN');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (claims.role !== 'admin' || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error('EXPIRED_TOKEN');
    claims.storeId = normalizeStoreId(claims.storeId);
    return claims;
}

async function loginAdmin(storeId, pin) {
    const setting = await Setting.findOne({ storeId, key: 'admin_pin_hash' }).lean();
    if (!setting) throw new Error('ADMIN_PIN_NOT_CONFIGURED');
    if (!await verifyPin(pin, setting.value)) throw new Error('INVALID_CREDENTIALS');
    return signToken(storeId);
}

function requireAdmin(req, res, next) {
    try {
        const authorization = req.get('authorization') || '';
        const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
        const claims = verifyToken(token);
        if (claims.storeId !== req.storeId) return res.status(403).json({ error: 'Token does not belong to this store' });
        req.admin = claims;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Admin authentication required' });
    }
}

module.exports = { hashPin, verifyPin, signToken, loginAdmin, requireAdmin, verifyToken };
