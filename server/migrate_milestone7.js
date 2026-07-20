const mongoose = require('mongoose');
require('./loadEnv');

const DEFAULT_PACKAGES = [
    { code: 'basic', name: 'Basic', monthlyPrice: 0 },
    { code: 'starter', name: 'Starter', monthlyPrice: 0 },
    { code: 'pro', name: 'Pro', monthlyPrice: 0 },
    { code: 'business', name: 'Business', monthlyPrice: 0 }
];

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const users = db.collection('platform_users');
    const stores = db.collection('stores');
    const members = db.collection('storemembers');
    const packages = db.collection('platformpackages');
    const audits = db.collection('platformaudits');
    const now = new Date();

    const ownerIds = (await stores.find({ ownerId: { $exists: true, $ne: null } }, { projection: { ownerId: 1 } }).toArray()).map(store => store.ownerId);
    const platformResult = await users.updateMany({ role: 'platform_admin' }, { $set: { role: 'PLATFORM_ADMIN', updatedAt: now } });
    const ownerResult = await users.updateMany({ role: 'merchant', _id: { $in: ownerIds } }, { $set: { role: 'STORE_OWNER', updatedAt: now } });
    const staffResult = await users.updateMany({ role: 'merchant' }, { $set: { role: 'STORE_STAFF', updatedAt: now } });
    const platformUsers = await users.find({ role: { $in: ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'] } }, { projection: { _id: 1 } }).toArray();
    const conflictingMemberships = await members.deleteMany({ userId: { $in: platformUsers.map(user => user._id) } });

    let packagesCreated = 0;
    for (const item of DEFAULT_PACKAGES) {
        const result = await packages.updateOne(
            { code: item.code },
            { $setOnInsert: { ...item, currency: 'THB', features: [], notificationQuota: null, isActive: true, createdAt: now, updatedAt: now } },
            { upsert: true }
        );
        packagesCreated += result.upsertedCount;
    }
    await Promise.all([
        packages.createIndex({ code: 1 }, { unique: true }),
        audits.createIndex({ storeId: 1, createdAt: -1 }),
        audits.createIndex({ actorUserId: 1, createdAt: -1 }),
        audits.createIndex({ action: 1, createdAt: -1 })
    ]);

    const summary = {
        platformAdminsMigrated: platformResult.modifiedCount,
        storeOwnersMigrated: ownerResult.modifiedCount,
        storeStaffMigrated: staffResult.modifiedCount,
        conflictingPlatformMembershipsRemoved: conflictingMemberships.deletedCount,
        packagesCreated
    };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 7 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
