const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrate } = require('../migrate_milestone7');

test('Milestone 7 migration separates roles and creates packages idempotently', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone7-migration');
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('milestone7-migration');
        const ownerId = new ObjectId(); const staffId = new ObjectId(); const platformId = new ObjectId();
        await db.collection('platform_users').insertMany([{ _id: ownerId, role: 'merchant' }, { _id: staffId, role: 'merchant' }, { _id: platformId, role: 'platform_admin' }]);
        await db.collection('stores').insertOne({ storeId: 'legacy', ownerId });
        await db.collection('storemembers').insertMany([{ storeId: 'legacy', userId: ownerId, role: 'owner' }, { storeId: 'legacy', userId: staffId, role: 'staff' }, { storeId: 'legacy', userId: platformId, role: 'viewer' }]);
        const first = await migrate(uri); const second = await migrate(uri);
        assert.equal((await db.collection('platform_users').findOne({ _id: ownerId })).role, 'STORE_OWNER');
        assert.equal((await db.collection('platform_users').findOne({ _id: staffId })).role, 'STORE_STAFF');
        assert.equal((await db.collection('platform_users').findOne({ _id: platformId })).role, 'PLATFORM_ADMIN');
        assert.equal(await db.collection('storemembers').countDocuments({ userId: platformId }), 0);
        assert.equal(await db.collection('platformpackages').countDocuments(), 4);
        assert.equal(first.packagesCreated, 4);
        assert.equal(second.packagesCreated, 0);
    } finally { await client.close(); await memoryServer.stop(); }
});
