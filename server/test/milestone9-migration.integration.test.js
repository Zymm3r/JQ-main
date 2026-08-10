const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrate } = require('../migrate_milestone9');

test('Milestone 9 migration is idempotent and preserves customized timing values', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone9-migration');
    const client = new MongoClient(uri);
    await client.connect();
    try {
        const db = client.db('milestone9-migration');
        const createdAt = new Date('2026-08-10T08:00:00.000Z');
        await db.collection('storesettings').insertMany([
            { storeId: 'default-values', branchId: 'default', autoCallEnabled: true },
            { storeId: 'custom-values', branchId: 'default', autoCallEnabled: true, autoCallDelayMinutes: 25, seatGracePeriodMinutes: 8, diningTimeLimitMinutes: 120, autoCancelNoShowEnabled: true }
        ]);
        await db.collection('queues').insertMany([
            { storeId: 'default-values', branchId: 'default', sessionId: 's1', queueNumber: 1, customerName: 'A', status: 'waiting', createdAt },
            { storeId: 'custom-values', branchId: 'default', sessionId: 's2', queueNumber: 1, customerName: 'B', status: 'waiting', createdAt },
            { storeId: 'custom-values', branchId: 'default', sessionId: 's2', queueNumber: 2, customerName: 'Called', status: 'called', createdAt, calledAt: createdAt },
            { storeId: 'custom-values', branchId: 'default', sessionId: 's2', queueNumber: 3, customerName: 'Dining', status: 'dining', createdAt, seatedAt: createdAt }
        ]);

        await migrate(uri);
        await migrate(uri);
        const custom = await db.collection('storesettings').findOne({ storeId: 'custom-values' });
        assert.equal(custom.autoCallDelayMinutes, 25);
        assert.equal(custom.seatGracePeriodMinutes, 8);
        assert.equal(custom.diningTimeLimitMinutes, 120);
        assert.equal(custom.autoCancelNoShowEnabled, true);
        const defaultQueue = await db.collection('queues').findOne({ storeId: 'default-values' });
        const customQueue = await db.collection('queues').findOne({ storeId: 'custom-values', queueNumber: 1 });
        assert.equal(defaultQueue.scheduledCallAt.toISOString(), new Date(createdAt.getTime() + 15 * 60_000).toISOString());
        assert.equal(customQueue.scheduledCallAt.toISOString(), new Date(createdAt.getTime() + 25 * 60_000).toISOString());
        const calledQueue = await db.collection('queues').findOne({ storeId: 'custom-values', queueNumber: 2 });
        const diningQueue = await db.collection('queues').findOne({ storeId: 'custom-values', queueNumber: 3 });
        assert.equal(calledQueue.seatDeadlineAt.toISOString(), new Date(createdAt.getTime() + 8 * 60_000).toISOString());
        assert.equal(diningQueue.diningDeadlineAt.toISOString(), new Date(createdAt.getTime() + 120 * 60_000).toISOString());
    } finally {
        await client.close();
        await memoryServer.stop();
    }
});
