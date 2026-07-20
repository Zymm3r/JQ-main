const mongoose = require('mongoose');
require('./loadEnv');

const { DEFAULT_STORE_ID } = require('./config');
const { hashPin } = require('./services/adminAuth');

function sameIndex(keys, expected) {
    return JSON.stringify(keys) === JSON.stringify(expected);
}

async function dropLegacyIndex(collection, expectedKeys) {
    let indexes;
    try {
        indexes = await collection.indexes();
    } catch (error) {
        if (error.code === 26 || error.codeName === 'NamespaceNotFound') return;
        throw error;
    }
    const legacy = indexes.find(index => sameIndex(index.key, expectedKeys));
    if (legacy) {
        await collection.dropIndex(legacy.name);
        console.log(`Dropped superseded index ${collection.collectionName}.${legacy.name}`);
    }
}

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const storeId = DEFAULT_STORE_ID;

    const queues = db.collection('queues');
    const settings = db.collection('settings');
    const counters = db.collection('counters');
    const stores = db.collection('stores');
    const users = db.collection('users');

    const queueResult = await queues.updateMany(
        { $or: [{ storeId: { $exists: false } }, { storeId: null }] },
        [{ $set: { storeId, lineUserId: { $ifNull: ['$lineUserId', '$line_id'] } } }]
    );
    const lineIdResult = await queues.updateMany(
        { lineUserId: { $exists: false }, line_id: { $nin: [null, ''] } },
        [{ $set: { lineUserId: '$line_id' } }]
    );
    const settingsResult = await settings.updateMany(
        { $or: [{ storeId: { $exists: false } }, { storeId: null }] },
        { $set: { storeId } }
    );
    const counterResult = await counters.updateMany(
        { $or: [{ storeId: { $exists: false } }, { storeId: null }] },
        { $set: { storeId } }
    );
    const userResult = await users.updateMany(
        { $or: [{ storeId: { $exists: false } }, { storeId: null }] },
        [{ $set: { storeId, lineUserId: { $ifNull: ['$lineUserId', '$line_id'] } } }]
    );

    await stores.updateOne(
        { storeId },
        {
            $setOnInsert: { storeId, name: process.env.LEGACY_STORE_NAME || 'Shabu Q', createdAt: new Date() },
            $set: {
                verificationStatus: 'verified',
                subscriptionStatus: 'active',
                plan: 'basic',
                isActive: true,
                updatedAt: new Date()
            }
        },
        { upsert: true }
    );

    await dropLegacyIndex(queues, { sessionId: 1, queueNumber: 1 });
    await dropLegacyIndex(settings, { key: 1 });
    await dropLegacyIndex(counters, { sessionId: 1 });
    await dropLegacyIndex(users, { line_id: 1 });

    await queues.createIndex({ storeId: 1, sessionId: 1, queueNumber: 1 }, { unique: true });
    await settings.createIndex({ storeId: 1, key: 1 }, { unique: true });
    await counters.createIndex({ storeId: 1, sessionId: 1 }, { unique: true });
    await users.createIndex({ storeId: 1, lineUserId: 1 }, { unique: true });

    const defaults = [
        ['store_name', process.env.LEGACY_STORE_NAME || 'Shabu Q'],
        ['table_count', process.env.LEGACY_TABLE_COUNT || '10'],
        ['avg_time', '30'],
        ['avg_wait_time', '15'],
        ['active_session', `session_${Date.now()}`]
    ];
    for (const [key, value] of defaults) {
        await settings.updateOne(
            { storeId, key },
            { $setOnInsert: { storeId, key, value, createdAt: new Date(), updatedAt: new Date() } },
            { upsert: true }
        );
    }

    if (process.env.LEGACY_ADMIN_PIN) {
        const currentPin = await settings.findOne({ storeId, key: 'admin_pin_hash' });
        if (!currentPin) {
            await settings.insertOne({
                storeId,
                key: 'admin_pin_hash',
                value: await hashPin(process.env.LEGACY_ADMIN_PIN),
                createdAt: new Date(),
                updatedAt: new Date()
            });
        }
    }

    const summary = {
        storeId,
        queuesBackfilled: queueResult.modifiedCount,
        lineUserIdsBackfilled: lineIdResult.modifiedCount,
        settingsBackfilled: settingsResult.modifiedCount,
        countersBackfilled: counterResult.modifiedCount,
        usersBackfilled: userResult.modifiedCount,
        legacyLineIdPreserved: true
    };
    console.log(JSON.stringify(summary, null, 2));
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().catch(async error => {
        console.error('Multi-tenant migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
