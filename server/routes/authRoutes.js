const express = require('express');
const crypto = require('crypto');
const User = require('../models/User');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const { hashPin: hashPassword, verifyPin: verifyPassword } = require('../services/adminAuth');
const { signAccountToken, requireAccount } = require('../services/accountAuth');
const { issueVerificationCode, isVerificationCodeValid } = require('../services/verificationService');
const { createRateLimiter } = require('../services/rateLimit');
const { effectivePermissions } = require('../services/memberPermissions');
const { isStoreRole } = require('../services/platformPermissions');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const registrationLimit = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 5 });
const loginLimit = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 10,
    key: req => `${req.ip}:${String(req.body.email || '').trim().toLowerCase()}`
});
const verificationLimit = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

function publicUser(user) {
    return {
        id: user._id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        role: user.role,
        status: user.status,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt
    };
}

function publicStore(store, membership = null) {
    if (!store) return null;
    return {
        storeId: store.storeId,
        name: store.name,
        slug: store.slug,
        verificationStatus: store.verificationStatus,
        subscriptionStatus: store.subscriptionStatus,
        plan: store.plan,
        isActive: store.isActive,
        membership: membership ? { role: membership.role, permissions: effectivePermissions(membership), status: membership.status } : null
    };
}

router.post('/register', registrationLimit, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();
    const phone = String(req.body.phone || '').trim();
    const acceptedTerms = req.body.acceptedTerms === true;

    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (password.length < 10) return res.status(400).json({ error: 'Password must contain at least 10 characters' });
    if (!name || name.length > 120) return res.status(400).json({ error: 'Name is required' });
    if (!phone || phone.length > 30) return res.status(400).json({ error: 'Phone is required' });
    if (!acceptedTerms) return res.status(400).json({ error: 'Terms of service must be accepted' });

    let user;
    let store;
    let membership;
    try {
        user = await User.create({
            email,
            passwordHash: await hashPassword(password),
            name,
            phone,
            acceptedTermsAt: new Date(),
            role: 'STORE_OWNER'
        });
        store = await Store.create({
            storeId: `store-${crypto.randomUUID()}`,
            ownerId: user._id,
            phone,
            verificationStatus: 'draft',
            subscriptionStatus: 'active',
            plan: 'basic',
            isActive: false
        });
        membership = await StoreMember.create({ storeId: store.storeId, userId: user._id, role: 'owner', status: 'active' });
        const code = await issueVerificationCode(await User.findById(user._id).select('+verificationCodeHash +verificationExpiresAt +verificationSentAt'));
        res.status(201).json({
            token: signAccountToken(user, store),
            user: publicUser(user),
            store: publicStore(store, membership),
            ...(process.env.NODE_ENV !== 'production' ? { devVerificationCode: code } : {})
        });
    } catch (error) {
        if (membership?._id) await StoreMember.deleteOne({ _id: membership._id }).catch(() => {});
        if (store?._id) await Store.deleteOne({ _id: store._id }).catch(() => {});
        if (user?._id) await User.deleteOne({ _id: user._id }).catch(() => {});
        if (error.code === 11000) return res.status(409).json({ error: 'Email is already registered' });
        console.error('Registration failed:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

router.post('/login', loginLimit, async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const user = await User.findOne({ email }).select('+passwordHash');
        if (!user || !await verifyPassword(String(req.body.password || ''), user.passwordHash)) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        if (user.status === 'suspended') return res.status(403).json({ error: 'Account is suspended' });
        let store = await Store.findOne({ ownerId: user._id });
        let membership = store ? await StoreMember.findOne({ storeId: store.storeId, userId: user._id, status: 'active' }) : null;
        if (!store) {
            membership = await StoreMember.findOne({ userId: user._id, status: 'active' });
            store = membership ? await Store.findOne({ storeId: membership.storeId }) : null;
        }
        if (isStoreRole(user.role) && (!store || (!membership && !store.ownerId?.equals(user._id)))) {
            return res.status(403).json({ error: 'No active store membership' });
        }
        const effectiveMembership = membership || (store ? { role: 'owner', permissions: [], status: 'active' } : null);
        res.json({ token: signAccountToken(user, store), user: publicUser(user), store: publicStore(store, effectiveMembership) });
    } catch (error) {
        res.status(500).json({ error: 'Login failed' });
    }
});

router.get('/me', requireAccount, (req, res) => {
    res.json({
        user: publicUser(req.account),
        store: publicStore(req.accountStore, req.auth.memberRole ? { role: req.auth.memberRole, permissions: req.auth.permissions, status: 'active' } : null)
    });
});

router.post('/send-verification', verificationLimit, requireAccount, async (req, res) => {
    if (req.account.emailVerified) return res.json({ success: true, alreadyVerified: true });
    try {
        const user = await User.findById(req.account._id).select('+verificationCodeHash +verificationExpiresAt +verificationSentAt');
        const code = await issueVerificationCode(user);
        res.json({ success: true, ...(process.env.NODE_ENV !== 'production' ? { devVerificationCode: code } : {}) });
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message === 'PLEASE_WAIT_BEFORE_RESENDING' ? 'Please wait before requesting another code' : 'Unable to send verification code' });
    }
});

router.post('/verify-email', verificationLimit, requireAccount, async (req, res) => {
    const user = await User.findById(req.account._id).select('+verificationCodeHash +verificationExpiresAt +verificationSentAt');
    if (user.emailVerified) return res.json({ success: true });
    if (!isVerificationCodeValid(user, req.body.code)) return res.status(400).json({ error: 'Invalid or expired verification code' });
    user.emailVerified = true;
    user.status = 'active';
    user.verificationCodeHash = null;
    user.verificationExpiresAt = null;
    await user.save();
    res.json({ success: true, user: publicUser(user) });
});

module.exports = router;
