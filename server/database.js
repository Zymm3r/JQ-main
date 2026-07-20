const Store = require('./models/Store');
const User = require('./models/User');
const Setting = require('./models/Setting');
const QueueSession = require('./models/QueueSession');
const { ensureStoreSettings } = require('./services/storeSettingsService');
const { createSession } = require('./services/queueSessionService');
const { DEFAULT_STORE_ID } = require('./config');
const { hashPin } = require('./services/adminAuth');
const { ensureDefaultBranch } = require('./services/branchService');

async function initDb() {
    const storeId = DEFAULT_STORE_ID;
    const store = await Store.findOneAndUpdate(
        { storeId },
        {
            $setOnInsert: { storeId, name: process.env.LEGACY_STORE_NAME || 'Shabu Q' },
            $set: {
                verificationStatus: 'verified',
                subscriptionStatus: 'active',
                plan: 'basic',
                isActive: true
            }
        },
        { upsert: true, new: true, runValidators: true }
    );
    await ensureDefaultBranch(store);

    const defaults = [
        { key: 'store_name', value: process.env.LEGACY_STORE_NAME || 'Shabu Q' },
        { key: 'table_count', value: process.env.LEGACY_TABLE_COUNT || '10' },
        { key: 'avg_time', value: '30' },
        { key: 'avg_wait_time', value: '15' }
    ];

    for (const setting of defaults) {
        await Setting.findOneAndUpdate(
            { storeId, key: setting.key },
            { $setOnInsert: { storeId, key: setting.key, value: setting.value } },
            { upsert: true, new: true, runValidators: true }
        );
    }

    await ensureStoreSettings(storeId, {
        averageTableTime: Number(process.env.LEGACY_AVG_TABLE_TIME) || 30,
        averageWaitTime: Number(process.env.LEGACY_AVG_WAIT_TIME) || 15,
        totalTables: Number(process.env.LEGACY_TABLE_COUNT) || 10
    });
    if (!await QueueSession.exists({ storeId, branchId: 'default', status: 'active' })) await createSession(storeId, null, 'default');

    const pinSetting = await Setting.findOne({ storeId, key: 'admin_pin_hash' }).lean();
    if (!pinSetting && process.env.LEGACY_ADMIN_PIN) {
        await Setting.create({ storeId, key: 'admin_pin_hash', value: await hashPin(process.env.LEGACY_ADMIN_PIN) });
    } else if (!pinSetting) {
        console.warn('LEGACY_ADMIN_PIN is not set; admin login is disabled until an admin PIN hash is configured.');
    }

    if (process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD) {
        const email = process.env.PLATFORM_ADMIN_EMAIL.trim().toLowerCase();
        const admin = await User.findOne({ email });
        if (!admin) {
            await User.create({
                email,
                passwordHash: await hashPin(process.env.PLATFORM_ADMIN_PASSWORD),
                name: process.env.PLATFORM_ADMIN_NAME || 'Platform Admin',
                phone: process.env.PLATFORM_ADMIN_PHONE || '-',
                role: 'PLATFORM_ADMIN',
                status: 'active',
                emailVerified: true,
                acceptedTermsAt: new Date()
            });
            console.log('Platform administrator account created from environment configuration.');
        }
    }

    console.log(`Database defaults are ready for store ${storeId}.`);
}

module.exports = { initDb };
