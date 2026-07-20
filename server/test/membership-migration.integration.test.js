const test = require('node:test');
const assert = require('node:assert/strict');
const { MongoClient } = require('mongodb');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { migrateMembership } = require('../migrate_membership');

test('membership migration preserves and activates the legacy store', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    const uri = memoryServer.getUri('membership-migration');
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db('membership-migration');
        await db.collection('stores').insertOne({ storeId: 'legacy-store', status: 'active', customLegacyValue: 'preserve-me' });

        const first = await migrateMembership(uri);
        const second = await migrateMembership(uri);
        const store = await db.collection('stores').findOne({ storeId: 'legacy-store' });

        assert.equal(first.destructiveOperations, 0);
        assert.equal(second.destructiveOperations, 0);
        assert.equal(store.customLegacyValue, 'preserve-me');
        assert.equal(store.verificationStatus, 'verified');
        assert.equal(store.subscriptionStatus, 'active');
        assert.equal(store.isActive, true);

        const indexes = await db.collection('stores').indexes();
        assert.ok(indexes.some(index => index.unique && index.key.slug === 1));
        assert.equal(await db.collection('platform_users').countDocuments(), 0);
    } finally {
        await client.close();
        await memoryServer.stop();
    }
});
