const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient, ObjectId } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrate } = require('../migrate_milestone6');

test('Milestone 6 migration creates default branches and owner memberships idempotently', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone6-migration');
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('milestone6-migration');
        const ownerId = new ObjectId();
        await db.collection('stores').insertOne({ storeId: 'legacy', ownerId, name: 'Legacy Store' });
        await db.collection('queues').insertOne({ storeId: 'legacy', sessionId: 's1', queueNumber: 1 });
        await db.collection('queuesessions').insertOne({ storeId: 'legacy', sessionId: 's1', status: 'active' });
        await db.collection('counters').insertOne({ storeId: 'legacy', sessionId: 's1', seq: 1 });
        await db.collection('storesettings').insertOne({ storeId: 'legacy', queueOpen: true });

        const first = await migrate(uri);
        const second = await migrate(uri);
        assert.equal(first.defaultBranchesCreated, 1);
        assert.equal(first.ownerMembershipsCreated, 1);
        assert.equal(second.defaultBranchesCreated, 0);
        assert.equal(second.ownerMembershipsCreated, 0);
        assert.equal((await db.collection('queues').findOne({ storeId: 'legacy' })).branchId, 'default');
        assert.equal((await db.collection('queuesessions').findOne({ storeId: 'legacy' })).branchId, 'default');
        assert.equal((await db.collection('counters').findOne({ storeId: 'legacy' })).branchId, 'default');
        assert.equal((await db.collection('storesettings').findOne({ storeId: 'legacy' })).branchId, 'default');
        assert.equal((await db.collection('storemembers').findOne({ storeId: 'legacy' })).role, 'owner');
        assert.equal((await db.collection('branches').findOne({ storeId: 'legacy' })).isDefault, true);
    } finally {
        await client.close(); await memoryServer.stop();
    }
});
