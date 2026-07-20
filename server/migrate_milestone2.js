const crypto = require('crypto');
const mongoose = require('mongoose');
require('./loadEnv');

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const queues = db.collection('queues');
    const settings = db.collection('settings');
    const sessions = db.collection('queuesessions');
    const storeSettings = db.collection('storesettings');

    const legacyQueues = await queues.find({
        $or: [
            { publicToken: { $exists: false } },
            { customerName: { $exists: false } },
            { createdAt: { $exists: false } }
        ]
    }).toArray();
    if (legacyQueues.length) {
        await queues.bulkWrite(legacyQueues.map(queue => ({
            updateOne: {
                filter: { _id: queue._id },
                update: {
                    $set: {
                        publicToken: queue.publicToken || crypto.randomBytes(24).toString('base64url'),
                        customerName: queue.customerName || queue.customer_name || 'Unknown',
                        phoneNumber: queue.phoneNumber ?? queue.phone_number ?? null,
                        seatedAt: queue.seatedAt ?? queue.start_time ?? null,
                        completedAt: queue.completedAt ?? queue.end_time ?? null,
                        createdAt: queue.createdAt || queue.created_at || new Date(),
                        updatedAt: queue.updatedAt || queue.updated_at || new Date()
                    }
                }
            }
        })));
    }

    const stores = await db.collection('stores').find({}, { projection: { storeId: 1 } }).toArray();
    for (const store of stores) {
        const values = Object.fromEntries((await settings.find({ storeId: store.storeId }).toArray()).map(item => [item.key, item.value]));
        await storeSettings.updateOne(
            { storeId: store.storeId },
            { $setOnInsert: {
                storeId: store.storeId,
                averageTableTime: Number(values.avg_time) || 30,
                averageWaitTime: Number(values.avg_wait_time) || 15,
                totalTables: Number(values.table_count) || 10,
                maxQueueSize: 100,
                autoCallEnabled: false,
                queueOpen: true,
                businessHours: [],
                createdAt: new Date(),
                updatedAt: new Date()
            } },
            { upsert: true }
        );
        if (!await sessions.findOne({ storeId: store.storeId, status: 'active' })) {
            const sessionId = values.active_session || `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
            await sessions.insertOne({ storeId: store.storeId, sessionId, status: 'active', startedAt: new Date(), endedAt: null, startedBy: null, createdAt: new Date(), updatedAt: new Date() });
        }
    }

    await queues.createIndex({ storeId: 1, publicToken: 1 }, { unique: true });
    await sessions.createIndex({ storeId: 1, sessionId: 1 }, { unique: true });
    await sessions.createIndex({ storeId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
    await storeSettings.createIndex({ storeId: 1 }, { unique: true });
    const removedLegacySessions = await settings.deleteMany({ key: 'active_session' });

    const summary = { queuesMigrated: legacyQueues.length, storesProvisioned: stores.length, legacyActiveSessionSettingsRemoved: removedLegacySessions.deletedCount };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 2 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
