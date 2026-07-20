const Branch = require('../models/Branch');

const DEFAULT_BRANCH_ID = 'default';

async function ensureDefaultBranch(store) {
    return Branch.findOneAndUpdate(
        { storeId: store.storeId, branchId: DEFAULT_BRANCH_ID },
        { $setOnInsert: {
            storeId: store.storeId,
            branchId: DEFAULT_BRANCH_ID,
            name: store.name || 'สาขาหลัก',
            slug: 'default',
            address: store.address || null,
            phone: store.phone || null,
            timezone: 'Asia/Bangkok',
            isActive: true,
            isDefault: true
        } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function resolveBranch(store, requestedBranchId = null, { includeInactive = false } = {}) {
    const defaultBranch = await ensureDefaultBranch(store);
    const branchId = String(requestedBranchId || defaultBranch.branchId).trim();
    const branch = await Branch.findOne({
        storeId: store.storeId,
        branchId,
        ...(includeInactive ? {} : { isActive: true })
    });
    if (!branch) {
        const error = new Error('BRANCH_NOT_FOUND');
        error.statusCode = 404;
        throw error;
    }
    return branch;
}

async function requireBranch(req, res, next) {
    try {
        const branch = await resolveBranch(req.accountStore, req.get('x-branch-id'));
        req.branch = branch;
        req.auth.branchId = branch.branchId;
        next();
    } catch (error) {
        res.status(error.statusCode || 500).json({ error: error.message === 'BRANCH_NOT_FOUND' ? 'Branch not found' : 'Unable to resolve branch' });
    }
}

module.exports = { DEFAULT_BRANCH_ID, ensureDefaultBranch, resolveBranch, requireBranch };
