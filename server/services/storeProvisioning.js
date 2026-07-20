const { ensureStoreSettings } = require('./storeSettingsService');
const { createSession } = require('./queueSessionService');
const QrSource = require('../models/QrSource');
const { ensureLiffSlug } = require('./liffService');
const { ensureDefaultBranch } = require('./branchService');

async function ensureStoreQueueSettings(store) {
    if (ensureLiffSlug(store) && store.isModified('liffSlug')) await store.save();
    const branch = await ensureDefaultBranch(store);
    await ensureStoreSettings(store.storeId, {}, branch.branchId);
    const QueueSession = require('../models/QueueSession');
    const activeSession = await QueueSession.findOne({ storeId: store.storeId, branchId: branch.branchId, status: 'active' });
    if (!activeSession) await createSession(store.storeId, store.ownerId, branch.branchId);
    await QrSource.findOneAndUpdate(
        { storeId: store.storeId, key: 'main' },
        { $setOnInsert: { storeId: store.storeId, key: 'main', name: 'QR หลักของร้าน', kind: 'main' } },
        { upsert: true, new: true }
    );
}

module.exports = { ensureStoreQueueSettings };
