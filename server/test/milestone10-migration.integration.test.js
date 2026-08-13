const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrate } = require('../migrate_milestone10');

test('Milestone 10 migration is idempotent and preserves configured automation values', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone10-migration');
    const client = new MongoClient(uri);
    await client.connect();
    try {
        const db = client.db('milestone10-migration');
        const latestCall = new Date('2026-08-10T10:30:00.000Z');
        await db.collection('storesettings').insertMany([
            { storeId: 'defaults', branchId: 'default', autoCallEnabled: true },
            {
                storeId: 'custom', branchId: 'default', autoCallEnabled: true,
                autoCallIntervalMinutes: 9, autoCallScheduleEnabled: true,
                autoCallScheduleStart: '11:00', autoCallScheduleEnd: '01:00', autoCompleteEnabled: true
            }
        ]);
        await db.collection('queues').insertOne({
            storeId: 'defaults', branchId: 'default', sessionId: 'session-1', queueNumber: 1,
            status: 'waiting', scheduledCallAt: latestCall
        });

        await migrate(uri);
        await migrate(uri);

        const defaults = await db.collection('storesettings').findOne({ storeId: 'defaults' });
        const custom = await db.collection('storesettings').findOne({ storeId: 'custom' });
        assert.equal(defaults.autoCallIntervalMinutes, 5);
        assert.equal(defaults.autoCallScheduleEnabled, false);
        assert.equal(defaults.autoCompleteEnabled, false);
        assert.equal(defaults.nextAutoCallAt.toISOString(), latestCall.toISOString());
        assert.equal(custom.autoCallIntervalMinutes, 9);
        assert.equal(custom.autoCallScheduleEnabled, true);
        assert.equal(custom.autoCallScheduleStart, '11:00');
        assert.equal(custom.autoCallScheduleEnd, '01:00');
        assert.equal(custom.autoCompleteEnabled, true);

        const notificationIndexes = await db.collection('notificationlogs').indexes();
        assert.ok(notificationIndexes.some(index => index.key.storeId === 1 && index.key.eventKey === 1 && index.unique));
    } finally {
        await client.close();
        await memoryServer.stop();
    }
});
