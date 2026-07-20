const mongoose = require('mongoose');
require('./loadEnv');
const { DEFAULT_STORE_ID } = require('./config');

async function migrateMembership(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const now = new Date();

    const legacyResult = await db.collection('stores').updateOne(
        { storeId: DEFAULT_STORE_ID },
        {
            $set: {
                verificationStatus: 'verified',
                subscriptionStatus: 'active',
                plan: 'basic',
                isActive: true,
                updatedAt: now
            },
            $setOnInsert: {
                storeId: DEFAULT_STORE_ID,
                name: process.env.LEGACY_STORE_NAME || 'Shabu Q',
                createdAt: now
            }
        },
        { upsert: true }
    );

    await db.collection('platform_users').createIndex({ email: 1 }, { unique: true });
    await db.collection('platform_users').createIndex({ role: 1, status: 1 });
    await db.collection('stores').createIndex({ storeId: 1 }, { unique: true });
    await db.collection('stores').createIndex({ ownerId: 1 }, { unique: true, sparse: true });
    await db.collection('stores').createIndex({ slug: 1 }, { unique: true, sparse: true });
    await db.collection('stores').createIndex({ verificationStatus: 1, createdAt: 1 });
    await db.collection('storereviews').createIndex({ storeId: 1, createdAt: -1 });

    const summary = {
        legacyStoreMatched: legacyResult.matchedCount,
        legacyStoreCreated: legacyResult.upsertedCount,
        legacyStoreId: DEFAULT_STORE_ID,
        destructiveOperations: 0
    };
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrateMembership().catch(async error => {
        console.error('Membership migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrateMembership };
