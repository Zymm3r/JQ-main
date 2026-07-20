const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Store = require('../models/Store');
const StoreSetting = require('../models/StoreSetting');
const QueueSession = require('../models/QueueSession');
const Queue = require('../models/Queue');
const Counter = require('../models/Counter');
const { hashPin } = require('../services/adminAuth');
const { signAccountToken } = require('../services/accountAuth');
const createPublicQueueRoutes = require('../routes/publicQueueRoutes');
const createStoreQueueRoutes = require('../routes/storeQueueRoutes');

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
            'content-type': 'application/json',
            ...(options.token ? { authorization: `Bearer ${options.token}` } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, data: await response.json() };
}

async function createTenant(suffix) {
    const user = await User.create({
        email: `owner-${suffix}@example.com`, passwordHash: await hashPin('password-1234'),
        name: `Owner ${suffix}`, phone: '0800000000', role: 'merchant', status: 'active', emailVerified: true
    });
    const store = await Store.create({
        storeId: `store-${suffix}`, ownerId: user._id, name: `Store ${suffix}`, slug: `store-${suffix}`,
        verificationStatus: 'verified', subscriptionStatus: 'active', isActive: true
    });
    await StoreSetting.create({ storeId: store.storeId, queueOpen: true, totalTables: 10, maxQueueSize: 100 });
    const sessionId = `session-${suffix}`;
    await QueueSession.create({ storeId: store.storeId, sessionId, startedBy: user._id });
    await Counter.create({ storeId: store.storeId, sessionId, seq: 0 });
    return { user, store, token: signAccountToken(user, store) };
}

test('Milestone 2 isolates public and merchant queue operations by token-derived store', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone2-test'));
    const app = express();
    app.use(express.json());
    app.use('/api/public/stores/:storeSlug', createPublicQueueRoutes());
    app.use('/api/store', createStoreQueueRoutes());
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const tenantA = await createTenant('alpha');
        const tenantB = await createTenant('beta');

        const reserveA = await request(baseUrl, '/api/public/stores/store-alpha/reserve', {
            method: 'POST', body: { customerName: 'Alice', pax: 2 }
        });
        const reserveB = await request(baseUrl, '/api/public/stores/store-beta/reserve', {
            method: 'POST', body: { customerName: 'Bob', pax: 3 }
        });
        assert.equal(reserveA.status, 201);
        assert.equal(reserveB.status, 201);
        assert.equal(reserveA.data.queueNumber, 1);
        assert.equal(reserveB.data.queueNumber, 1);

        const queuesA = await request(baseUrl, '/api/store/queues', { token: tenantA.token });
        const queuesB = await request(baseUrl, '/api/store/queues', { token: tenantB.token });
        assert.deepEqual(queuesA.data.map(queue => queue.customerName), ['Alice']);
        assert.deepEqual(queuesB.data.map(queue => queue.customerName), ['Bob']);

        const crossTenantCall = await request(baseUrl, `/api/store/queues/${reserveB.data.id}/call`, {
            method: 'POST', token: tenantA.token, body: { storeId: tenantB.store.storeId }
        });
        assert.equal(crossTenantCall.status, 404);
        assert.equal((await Queue.findById(reserveB.data.id)).status, 'waiting');

        const crossTenantStatus = await request(baseUrl, `/api/public/stores/store-alpha/status/${reserveB.data.publicToken}`);
        assert.equal(crossTenantStatus.status, 404);
        const ownStatus = await request(baseUrl, `/api/public/stores/store-beta/status/${reserveB.data.publicToken}`);
        assert.equal(ownStatus.status, 200);
        assert.equal(ownStatus.data.customerName, 'Bob');

        const oldBSession = await QueueSession.findOne({ storeId: tenantB.store.storeId, status: 'active' });
        const resetA = await request(baseUrl, '/api/store/session/reset', { method: 'POST', token: tenantA.token });
        assert.equal(resetA.status, 201);
        assert.notEqual(resetA.data.sessionId, 'session-alpha');
        assert.equal((await QueueSession.findById(oldBSession._id)).status, 'active');
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect();
        await memoryServer.stop();
    }
});
