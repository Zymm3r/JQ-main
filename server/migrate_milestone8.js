const mongoose = require('mongoose');
const crypto = require('crypto');
require('./loadEnv');

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const queues = db.collection('queues');
    const stores = db.collection('stores');
    const notificationUsages = db.collection('notificationusages');
    const queuesMissingPublicToken = await queues.find({
        $or: [{ publicToken: { $exists: false } }, { publicToken: null }, { publicToken: '' }]
    }, { projection: { _id: 1 } }).toArray();
    if (queuesMissingPublicToken.length) {
        await queues.bulkWrite(queuesMissingPublicToken.map(queue => ({
            updateOne: {
                filter: { _id: queue._id },
                update: { $set: { publicToken: crypto.randomBytes(24).toString('base64url'), updatedAt: new Date() } }
            }
        })));
    }

    await queues.createIndex(
        { storeId: 1, branchId: 1, sessionId: 1, idempotencyKey: 1 },
        { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
    );
    await queues.createIndex({ storeId: 1, branchId: 1, sessionId: 1, status: 1, queueNumber: 1 });
    await queues.createIndex({ storeId: 1, publicToken: 1 }, { unique: true });
    await stores.updateMany(
        { verificationStatus: 'verified', isActive: true },
        { $set: { subscriptionStatus: 'active', subscriptionEndsAt: null, trialEndsAt: null, notificationQuotaOverride: null } }
    );
    await notificationUsages.updateMany({}, { $set: { limit: null, unlimited: true } });

    const summary = {
        idempotencyIndexReady: true,
        queuesBackfilledPublicToken: queuesMissingPublicToken.length,
        verifiedStoresNormalized: await stores.countDocuments({ verificationStatus: 'verified', isActive: true }),
        notificationUsageUnlimited: await notificationUsages.countDocuments({ unlimited: true })
    };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 8 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
