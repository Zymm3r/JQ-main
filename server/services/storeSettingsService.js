const StoreSetting = require('../models/StoreSetting');

async function ensureStoreSettings(storeId, overrides = {}, branchId = 'default') {
    return StoreSetting.findOneAndUpdate(
        { storeId, branchId },
        { $setOnInsert: { storeId, branchId, ...overrides } },
        { upsert: true, new: true, runValidators: true }
    );
}

module.exports = { ensureStoreSettings };
