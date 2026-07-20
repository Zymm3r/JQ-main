const mongoose = require('mongoose');
require('./loadEnv');

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const queues = db.collection('queues');
    const logs = db.collection('notificationlogs');
    const usage = db.collection('notificationusages');

    const queueResult = await queues.updateMany(
        { $or: [{ lastNotifiedQueueAhead: { $exists: false } }, { nearNotificationSentAt: { $exists: false } }] },
        [{ $set: {
            lastNotifiedQueueAhead: { $ifNull: ['$lastNotifiedQueueAhead', null] },
            nearNotificationSentAt: { $ifNull: ['$nearNotificationSentAt', null] }
        } }]
    );
    const usageResult = await usage.updateMany(
        { $or: [{ unlimited: { $ne: true } }, { limit: { $ne: null } }] },
        { $set: { unlimited: true, limit: null } }
    );
    await logs.createIndex({ storeId: 1, createdAt: -1 });
    await logs.createIndex({ storeId: 1, period: 1, status: 1 });
    await logs.createIndex({ status: 1, retryCount: 1, createdAt: -1 });
    await usage.createIndex({ storeId: 1, period: 1 }, { unique: true });
    await usage.createIndex({ period: 1, count: -1 });

    const summary = {
        queuesPreparedForPositionNotifications: queueResult.modifiedCount,
        notificationUsagesMadeUnlimited: usageResult.modifiedCount,
        notificationIndexesCreated: 5
    };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 4 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
