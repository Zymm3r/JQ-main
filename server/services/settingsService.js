const Setting = require('../models/Setting');

async function getSetting(storeId, key, fallback = null) {
    const setting = await Setting.findOne({ storeId, key }).lean();
    return setting?.value ?? fallback;
}

async function setSetting(storeId, key, value) {
    return Setting.findOneAndUpdate(
        { storeId, key },
        { $set: { value: String(value) } },
        { upsert: true, new: true, runValidators: true }
    );
}

module.exports = { getSetting, setSetting };
