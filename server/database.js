const Store = require('./models/Store');
const User = require('./models/User');
const StoreMember = require('./models/StoreMember');
const Setting = require('./models/Setting');
const QueueSession = require('./models/QueueSession');
const { ensureStoreSettings } = require('./services/storeSettingsService');
const { createSession } = require('./services/queueSessionService');
const { DEFAULT_STORE_ID } = require('./config');
const { hashPin } = require('./services/adminAuth');
const { ensureDefaultBranch } = require('./services/branchService');
const NotificationLog = require('./models/NotificationLog');

async function initDb() {
    // Notification idempotency depends on this unique index being ready before
    // the first worker or request attempts a LINE dispatch.
    await NotificationLog.createIndexes();
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

    if (process.env.DEMO_MERCHANT_EMAIL && process.env.DEMO_MERCHANT_PASSWORD) {
        await seedDemoMerchantAccount();
    }

    console.log(`Database defaults are ready for store ${storeId}.`);
}

async function seedDemoMerchantAccount() {
    const email = process.env.DEMO_MERCHANT_EMAIL.trim().toLowerCase();
    const password = process.env.DEMO_MERCHANT_PASSWORD;
    const storeSlug = String(process.env.DEMO_STORE_SLUG || 'demo-shabu-1').trim().toLowerCase();
    const store = await Store.findOne({ $or: [{ slug: storeSlug }, { liffSlug: storeSlug }] });
    if (!store) {
        console.warn(`DEMO_STORE_SLUG=${storeSlug} was configured, but no matching store was found.`);
        return;
    }

    let user = await User.findOne({ email }).select('+passwordHash');
    if (!user) {
        user = await User.create({
            email,
            passwordHash: await hashPin(password),
            name: process.env.DEMO_MERCHANT_NAME || `${store.name || 'Demo'} Owner`,
            phone: process.env.DEMO_MERCHANT_PHONE || '0800000000',
            role: 'STORE_OWNER',
            status: 'active',
            emailVerified: true,
            acceptedTermsAt: new Date()
        });
    } else {
        user.passwordHash = await hashPin(password);
        user.name = user.name || process.env.DEMO_MERCHANT_NAME || `${store.name || 'Demo'} Owner`;
        user.phone = user.phone || process.env.DEMO_MERCHANT_PHONE || '0800000000';
        user.role = 'STORE_OWNER';
        user.status = 'active';
        user.emailVerified = true;
        user.acceptedTermsAt = user.acceptedTermsAt || new Date();
        await user.save();
    }

    store.ownerId = user._id;
    store.verificationStatus = 'verified';
    store.subscriptionStatus = 'active';
    store.isActive = true;
    store.plan = store.plan || 'basic';
    await store.save();

    await StoreMember.findOneAndUpdate(
        { storeId: store.storeId, userId: user._id },
        { $set: { role: 'owner', permissions: [], status: 'active' } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    console.log(`Demo merchant account is ready for store ${store.storeId}.`);
}

module.exports = { initDb };
