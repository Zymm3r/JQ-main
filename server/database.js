const Store = require('./models/Store');
const Setting = require('./models/Setting');
const { DEFAULT_STORE_ID } = require('./config');
const { hashPin } = require('./services/adminAuth');

async function initDb() {
    const storeId = DEFAULT_STORE_ID;
    await Store.findOneAndUpdate(
        { storeId },
        { $setOnInsert: { storeId, status: 'active' } },
        { upsert: true, new: true, runValidators: true }
    );

    const defaults = [
        { key: 'store_name', value: process.env.LEGACY_STORE_NAME || 'Shabu Q' },
        { key: 'table_count', value: process.env.LEGACY_TABLE_COUNT || '10' },
        { key: 'avg_time', value: '30' },
        { key: 'avg_wait_time', value: '15' },
        { key: 'active_session', value: `session_${Date.now()}` }
    ];

    for (const setting of defaults) {
        await Setting.findOneAndUpdate(
            { storeId, key: setting.key },
            { $setOnInsert: { storeId, key: setting.key, value: setting.value } },
            { upsert: true, new: true, runValidators: true }
        );
    }

    const pinSetting = await Setting.findOne({ storeId, key: 'admin_pin_hash' }).lean();
    if (!pinSetting && process.env.LEGACY_ADMIN_PIN) {
        await Setting.create({ storeId, key: 'admin_pin_hash', value: await hashPin(process.env.LEGACY_ADMIN_PIN) });
    } else if (!pinSetting) {
        console.warn('LEGACY_ADMIN_PIN is not set; admin login is disabled until an admin PIN hash is configured.');
    }

    console.log(`Database defaults are ready for store ${storeId}.`);
}

module.exports = { initDb };
