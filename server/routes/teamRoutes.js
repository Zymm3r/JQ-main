const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const Branch = require('../models/Branch');
const StoreMember = require('../models/StoreMember');
const User = require('../models/User');
const { hashPin: hashPassword } = require('../services/adminAuth');
const { requireAccount, requireVerifiedAccount } = require('../services/accountAuth');
const { requirePermission } = require('../services/memberPermissions');
const { ensureDefaultBranch } = require('../services/branchService');
const { ensureStoreSettings } = require('../services/storeSettingsService');
const { createSession } = require('../services/queueSessionService');
const { isStoreRole } = require('../services/platformPermissions');

const router = express.Router();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

router.use(requireAccount, requireVerifiedAccount);
router.use((req, res, next) => {
    if (!req.auth.storeId || !req.accountStore) return res.status(403).json({ error: 'Merchant store required' });
    next();
});

function memberJson(member) {
    const user = member.userId || {};
    return {
        id: member._id,
        storeId: member.storeId,
        user: { id: user._id, email: user.email, name: user.name, phone: user.phone },
        role: member.role,
        permissions: member.permissions,
        status: member.status,
        createdAt: member.createdAt
    };
}

function requestedPermissions(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map(String))].filter(permission => StoreMember.PERMISSIONS.includes(permission));
}

function canAssign(req, targetRole, permissions, currentRole = null) {
    if (req.auth.memberRole === 'owner') return true;
    if (targetRole === 'owner' || currentRole === 'owner') return false;
    return !permissions.includes('billing.manage') && permissions.every(permission => req.auth.permissions.includes(permission));
}

router.get('/members', requirePermission('members.manage'), async (req, res) => {
    const members = await StoreMember.find({ storeId: req.auth.storeId }).populate('userId', 'email name phone').sort({ createdAt: 1 });
    res.json(members.map(memberJson));
});

router.post('/members', requirePermission('members.manage'), async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const role = String(req.body.role || 'staff');
    const permissions = requestedPermissions(req.body.permissions);
    if (!EMAIL_PATTERN.test(email)) return res.status(400).json({ error: 'Valid email is required' });
    if (!StoreMember.ROLES.includes(role) || !canAssign(req, role, permissions)) return res.status(403).json({ error: 'Role or permissions cannot be assigned' });

    let user = await User.findOne({ email });
    let createdUser = false;
    try {
        if (!user) {
            const password = String(req.body.password || '');
            const name = String(req.body.name || '').trim();
            const phone = String(req.body.phone || '').trim();
            if (password.length < 10) return res.status(400).json({ error: 'Password must contain at least 10 characters' });
            if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required for a new account' });
            user = await User.create({ email, passwordHash: await hashPassword(password), name, phone, role: 'STORE_STAFF', status: 'active', emailVerified: true });
            createdUser = true;
        }
        if (!isStoreRole(user.role)) return res.status(409).json({ error: 'Platform account cannot become a store member' });
        const member = await StoreMember.create({ storeId: req.auth.storeId, userId: user._id, role, permissions, status: 'active' });
        await member.populate('userId', 'email name phone');
        res.status(201).json(memberJson(member));
    } catch (error) {
        if (createdUser && user?._id) await User.deleteOne({ _id: user._id }).catch(() => {});
        if (error.code === 11000) return res.status(409).json({ error: 'User is already a member of this store' });
        console.error('Member creation failed:', error);
        res.status(500).json({ error: 'Unable to create member' });
    }
});

router.patch('/members/:id', requirePermission('members.manage'), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid member ID' });
    const member = await StoreMember.findOne({ _id: req.params.id, storeId: req.auth.storeId });
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const role = req.body.role === undefined ? member.role : String(req.body.role);
    const permissions = req.body.permissions === undefined ? member.permissions : requestedPermissions(req.body.permissions);
    const status = req.body.status === undefined ? member.status : String(req.body.status);
    if (!StoreMember.ROLES.includes(role) || !['invited', 'active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid member update' });
    if (!canAssign(req, role, permissions, member.role)) return res.status(403).json({ error: 'Role or permissions cannot be assigned' });
    if (member.userId.equals(req.account._id) && status !== 'active') return res.status(409).json({ error: 'You cannot suspend your own membership' });
    member.role = role;
    member.permissions = permissions;
    member.status = status;
    await member.save();
    await member.populate('userId', 'email name phone');
    res.json(memberJson(member));
});

router.get('/branches', async (req, res) => {
    await ensureDefaultBranch(req.accountStore);
    res.json(await Branch.find({ storeId: req.auth.storeId }).sort({ isDefault: -1, name: 1 }).lean());
});

router.post('/branches', requirePermission('settings.update'), async (req, res) => {
    const name = String(req.body.name || '').trim();
    const slug = String(req.body.slug || '').trim().toLowerCase();
    const timezone = String(req.body.timezone || 'Asia/Bangkok').trim();
    if (!name || name.length > 160) return res.status(400).json({ error: 'Branch name is required' });
    if (!SLUG_PATTERN.test(slug) || slug === 'default' || slug.length > 80) return res.status(400).json({ error: 'Invalid branch slug' });
    try {
        const branch = await Branch.create({
            storeId: req.auth.storeId,
            branchId: `branch-${crypto.randomUUID()}`,
            name,
            slug,
            address: String(req.body.address || '').trim() || null,
            phone: String(req.body.phone || '').trim() || null,
            timezone,
            isActive: true
        });
        await ensureStoreSettings(req.auth.storeId, {}, branch.branchId);
        await createSession(req.auth.storeId, req.account._id, branch.branchId);
        res.status(201).json(branch);
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'Branch slug is already in use' });
        console.error('Branch creation failed:', error);
        res.status(500).json({ error: 'Unable to create branch' });
    }
});

router.patch('/branches/:branchId', requirePermission('settings.update'), async (req, res) => {
    const branch = await Branch.findOne({ storeId: req.auth.storeId, branchId: req.params.branchId });
    if (!branch) return res.status(404).json({ error: 'Branch not found' });
    if (branch.isDefault && req.body.isActive === false) return res.status(409).json({ error: 'Default branch cannot be deactivated' });
    if (req.body.name !== undefined) branch.name = String(req.body.name).trim();
    if (req.body.address !== undefined) branch.address = String(req.body.address).trim() || null;
    if (req.body.phone !== undefined) branch.phone = String(req.body.phone).trim() || null;
    if (req.body.timezone !== undefined) branch.timezone = String(req.body.timezone).trim();
    if (req.body.isActive !== undefined) branch.isActive = req.body.isActive === true;
    await branch.save();
    res.json(branch);
});

module.exports = router;
