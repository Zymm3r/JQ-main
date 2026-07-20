const crypto = require('crypto');
const mongoose = require('mongoose');
require('./loadEnv');

function suffix() {
    return crypto.randomBytes(4).toString('hex').slice(0, 5);
}

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const stores = db.collection('stores');
    const qrSources = db.collection('qrsources');
    const queues = db.collection('queues');
    const missing = await stores.find({ slug: { $nin: [null, ''] }, $or: [{ liffSlug: { $exists: false } }, { liffSlug: null }] }).toArray();

    for (const store of missing) {
        let liffSlug;
        do {
            liffSlug = `${store.slug}-${suffix()}`;
        } while (await stores.findOne({ liffSlug }));
        await stores.updateOne({ _id: store._id }, { $set: { liffSlug, updatedAt: new Date() } });
    }

    const allStores = await stores.find({ storeId: { $exists: true } }).toArray();
    for (const store of allStores) {
        await qrSources.updateOne(
            { storeId: store.storeId, key: 'main' },
            { $setOnInsert: {
                storeId: store.storeId, key: 'main', name: 'QR หลักของร้าน', kind: 'main', branchName: null,
                active: true, scanCount: 0, reservationCount: 0, createdAt: new Date(), updatedAt: new Date()
            } },
            { upsert: true }
        );
    }
    const queueResult = await queues.updateMany(
        { $or: [{ source: { $exists: false } }, { source: null }, { source: '' }] },
        { $set: { source: 'main' } }
    );
    await stores.createIndex({ liffSlug: 1 }, { unique: true, partialFilterExpression: { liffSlug: { $type: 'string' } } });
    await qrSources.createIndex({ storeId: 1, key: 1 }, { unique: true });

    const summary = { storesAssignedLiffSlug: missing.length, mainQrSourcesCreated: allStores.length, queuesAssignedSource: queueResult.modifiedCount };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 3 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
