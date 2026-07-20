const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');

const { migrate } = require('../migrate_multi_tenant');

test('legacy data migrates non-destructively and the migration is idempotent', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone0');
    const client = new MongoClient(uri);

    try {
        await client.connect();
        const db = client.db('milestone0');
        const now = new Date();

        await db.collection('queues').insertMany([
            { sessionId: 'session_legacy', queueNumber: 1, customer_name: 'A', line_id: 'U001', status: 'waiting', created_at: now },
            { sessionId: 'session_legacy', queueNumber: 2, customer_name: 'B', line_id: 'U002', status: 'called', created_at: now }
        ]);
        await db.collection('queues').createIndex({ sessionId: 1, queueNumber: 1 }, { unique: true });
        await db.collection('settings').insertMany([
            { key: 'active_session', value: 'session_legacy' },
            { key: 'avg_time', value: '30' }
        ]);
        await db.collection('settings').createIndex({ key: 1 }, { unique: true });
        await db.collection('counters').insertOne({ sessionId: 'session_legacy', seq: 2 });
        await db.collection('counters').createIndex({ sessionId: 1 }, { unique: true });
        await db.collection('users').insertMany([
            { line_id: 'U001', name: 'A' },
            { line_id: 'U002', name: 'B' }
        ]);
        await db.collection('users').createIndex({ line_id: 1 }, { unique: true });

        const before = {
            queues: await db.collection('queues').countDocuments(),
            settings: await db.collection('settings').countDocuments(),
            counters: await db.collection('counters').countDocuments(),
            users: await db.collection('users').countDocuments()
        };

        process.env.LEGACY_ADMIN_PIN = 'integration-test-pin';
        const firstRun = await migrate(uri);
        const secondRun = await migrate(uri);

        const after = {
            queues: await db.collection('queues').countDocuments(),
            counters: await db.collection('counters').countDocuments(),
            users: await db.collection('users').countDocuments()
        };
        assert.equal(after.queues, before.queues);
        assert.equal(after.counters, before.counters);
        assert.equal(after.users, before.users);
        assert.ok(await db.collection('settings').countDocuments() >= before.settings);

        const migratedQueue = await db.collection('queues').findOne({ queueNumber: 1 });
        assert.equal(migratedQueue.storeId, 'legacy-store');
        assert.equal(migratedQueue.lineUserId, 'U001');
        assert.equal(migratedQueue.line_id, 'U001');

        assert.equal(firstRun.queuesBackfilled, 2);
        assert.equal(firstRun.usersBackfilled, 2);
        assert.equal(secondRun.queuesBackfilled, 0);
        assert.equal(secondRun.usersBackfilled, 0);

        const queueIndexes = await db.collection('queues').indexes();
        assert.ok(queueIndexes.some(index =>
            index.unique && JSON.stringify(index.key) === JSON.stringify({ storeId: 1, sessionId: 1, queueNumber: 1 })
        ));
        assert.ok(await db.collection('settings').findOne({ storeId: 'legacy-store', key: 'admin_pin_hash' }));
    } finally {
        delete process.env.LEGACY_ADMIN_PIN;
        await client.close();
        await memoryServer.stop();
    }
});
