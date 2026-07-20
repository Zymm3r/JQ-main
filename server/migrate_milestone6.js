const mongoose = require('mongoose');
require('./loadEnv');

async function dropIndexesByShape(collection, shapes) {
    const indexes = await collection.indexes();
    let dropped = 0;
    for (const index of indexes) {
        if (index.name === '_id_') continue;
        const signature = JSON.stringify(index.key);
        if (shapes.includes(signature)) {
            await collection.dropIndex(index.name);
            dropped += 1;
        }
    }
    return dropped;
}

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const now = new Date();
    const stores = db.collection('stores');
    const branches = db.collection('branches');
    const members = db.collection('storemembers');
    const queues = db.collection('queues');
    const sessions = db.collection('queuesessions');
    const counters = db.collection('counters');
    const settings = db.collection('storesettings');

    const allStores = await stores.find({ storeId: { $type: 'string' } }).toArray();
    let defaultBranchesCreated = 0;
    let ownerMembershipsCreated = 0;
    for (const store of allStores) {
        const branchResult = await branches.updateOne(
            { storeId: store.storeId, branchId: 'default' },
            { $setOnInsert: {
                storeId: store.storeId,
                branchId: 'default',
                name: store.name || 'สาขาหลัก',
                slug: 'default',
                address: store.address || null,
                phone: store.phone || null,
                timezone: 'Asia/Bangkok',
                isActive: true,
                isDefault: true,
                createdAt: now,
                updatedAt: now
            } },
            { upsert: true }
        );
        defaultBranchesCreated += branchResult.upsertedCount;
        if (store.ownerId) {
            const memberResult = await members.updateOne(
                { storeId: store.storeId, userId: store.ownerId },
                { $setOnInsert: { storeId: store.storeId, userId: store.ownerId, role: 'owner', permissions: [], status: 'active', createdAt: now, updatedAt: now } },
                { upsert: true }
            );
            ownerMembershipsCreated += memberResult.upsertedCount;
        }
    }

    const [queueResult, sessionResult, counterResult, settingResult] = await Promise.all([
        queues.updateMany({ $or: [{ branchId: { $exists: false } }, { branchId: null }, { branchId: '' }] }, { $set: { branchId: 'default' } }),
        sessions.updateMany({ $or: [{ branchId: { $exists: false } }, { branchId: null }, { branchId: '' }] }, { $set: { branchId: 'default' } }),
        counters.updateMany({ $or: [{ branchId: { $exists: false } }, { branchId: null }, { branchId: '' }] }, { $set: { branchId: 'default' } }),
        settings.updateMany({ $or: [{ branchId: { $exists: false } }, { branchId: null }, { branchId: '' }] }, { $set: { branchId: 'default' } })
    ]);

    const droppedIndexes =
        await dropIndexesByShape(queues, [JSON.stringify({ storeId: 1, sessionId: 1, queueNumber: 1 })]) +
        await dropIndexesByShape(sessions, [JSON.stringify({ storeId: 1, sessionId: 1 }), JSON.stringify({ storeId: 1, status: 1 })]) +
        await dropIndexesByShape(counters, [JSON.stringify({ storeId: 1, sessionId: 1 })]) +
        await dropIndexesByShape(settings, [JSON.stringify({ storeId: 1 })]);

    await Promise.all([
        branches.createIndex({ storeId: 1, branchId: 1 }, { unique: true }),
        branches.createIndex({ storeId: 1, slug: 1 }, { unique: true }),
        branches.createIndex({ storeId: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } }),
        members.createIndex({ storeId: 1, userId: 1 }, { unique: true }),
        members.createIndex({ userId: 1, status: 1 }),
        queues.createIndex({ storeId: 1, branchId: 1, sessionId: 1, queueNumber: 1 }, { unique: true }),
        sessions.createIndex({ storeId: 1, branchId: 1, sessionId: 1 }, { unique: true }),
        sessions.createIndex({ storeId: 1, branchId: 1, status: 1 }, { unique: true, partialFilterExpression: { status: 'active' } }),
        counters.createIndex({ storeId: 1, branchId: 1, sessionId: 1 }, { unique: true }),
        settings.createIndex({ storeId: 1, branchId: 1 }, { unique: true })
    ]);

    const summary = {
        defaultBranchesCreated,
        ownerMembershipsCreated,
        queuesAssignedDefaultBranch: queueResult.modifiedCount,
        sessionsAssignedDefaultBranch: sessionResult.modifiedCount,
        countersAssignedDefaultBranch: counterResult.modifiedCount,
        settingsAssignedDefaultBranch: settingResult.modifiedCount,
        supersededIndexesDropped: droppedIndexes
    };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 6 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
