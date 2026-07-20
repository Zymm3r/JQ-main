const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrate } = require('../migrate_milestone4');

test('Milestone 4 migration prepares queue notification state and indexes idempotently', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone4-migration');
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('milestone4-migration');
        await db.collection('queues').insertOne({ storeId: 'legacy', sessionId: 's1', queueNumber: 1 });
        await db.collection('notificationusages').insertOne({ storeId: 'legacy', period: '2026-07', count: 100, limit: 100, plan: 'trial' });
        const first = await migrate(uri);
        const second = await migrate(uri);
        const queue = await db.collection('queues').findOne({ storeId: 'legacy' });
        const usage = await db.collection('notificationusages').findOne({ storeId: 'legacy' });
        assert.equal(queue.lastNotifiedQueueAhead, null);
        assert.equal(queue.nearNotificationSentAt, null);
        assert.equal(first.queuesPreparedForPositionNotifications, 1);
        assert.equal(second.queuesPreparedForPositionNotifications, 0);
        assert.equal(usage.limit, null);
        assert.equal(usage.unlimited, true);
        assert.equal(first.notificationUsagesMadeUnlimited, 1);
        assert.equal(second.notificationUsagesMadeUnlimited, 0);
        const usageIndexes = await db.collection('notificationusages').indexes();
        assert.ok(usageIndexes.some(index => index.unique && index.key.storeId === 1 && index.key.period === 1));
    } finally {
        await client.close(); await memoryServer.stop();
    }
});
