const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrate } = require('../migrate_milestone3');

test('Milestone 3 migration assigns stable LIFF slugs and is idempotent', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('milestone3-migration');
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('milestone3-migration');
        await db.collection('stores').insertOne({ storeId: 'store-old', slug: 'old-store', name: 'Old Store' });
        await db.collection('queues').insertOne({ storeId: 'store-old', sessionId: 'old-session', queueNumber: 1 });

        const first = await migrate(uri);
        const second = await migrate(uri);
        const store = await db.collection('stores').findOne({ storeId: 'store-old' });
        assert.match(store.liffSlug, /^old-store-[a-f0-9]{5}$/);
        assert.equal(first.storesAssignedLiffSlug, 1);
        assert.equal(second.storesAssignedLiffSlug, 0);
        assert.equal(await db.collection('qrsources').countDocuments({ storeId: 'store-old', key: 'main' }), 1);
        assert.equal((await db.collection('queues').findOne({ storeId: 'store-old' })).source, 'main');

        const storeIndexes = await db.collection('stores').indexes();
        const sourceIndexes = await db.collection('qrsources').indexes();
        assert.ok(storeIndexes.some(index => index.unique && index.key.liffSlug === 1));
        assert.ok(sourceIndexes.some(index => index.unique && index.key.storeId === 1 && index.key.key === 1));
    } finally {
        await client.close();
        await memoryServer.stop();
    }
});
