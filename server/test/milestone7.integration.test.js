const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const Branch = require('../models/Branch');
const StoreSetting = require('../models/StoreSetting');
const QueueSession = require('../models/QueueSession');
const Counter = require('../models/Counter');
const Queue = require('../models/Queue');
const NotificationLog = require('../models/NotificationLog');
const PlatformAudit = require('../models/PlatformAudit');
const { hashPin } = require('../services/adminAuth');
const { signAccountToken } = require('../services/accountAuth');
const NotificationService = require('../services/notificationService');
const platformRoutes = require('../routes/platformRoutes');
const createStoreQueueRoutes = require('../routes/storeQueueRoutes');

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, data: await response.json() };
}

test('Milestone 7 provides a separated, audited platform control plane', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone7-test'));
    NotificationService.setTransportForTests(async () => ({ ok: true }));
    const app = express(); app.use(express.json());
    app.use('/api/platform', platformRoutes);
    app.use('/api/store', createStoreQueueRoutes());
    const server = app.listen(0); const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const owner = await User.create({ email: 'm7-owner@example.com', passwordHash: await hashPin('owner-password'), name: 'Owner', phone: '0800000000', role: 'STORE_OWNER', status: 'active', emailVerified: true });
        const store = await Store.create({ storeId: 'm7-store', ownerId: owner._id, name: 'M7 Store', slug: 'm7-store', liffSlug: 'm7-store-liff', verificationStatus: 'verified', subscriptionStatus: 'active', plan: 'pro', isActive: true });
        await StoreMember.create({ storeId: store.storeId, userId: owner._id, role: 'owner', status: 'active' });
        await Branch.create({ storeId: store.storeId, branchId: 'default', name: 'Main', slug: 'default', isDefault: true });
        await StoreSetting.create({ storeId: store.storeId, branchId: 'default', queueOpen: true });
        await QueueSession.create({ storeId: store.storeId, branchId: 'default', sessionId: 'm7-session', startedBy: owner._id });
        await Counter.create({ storeId: store.storeId, branchId: 'default', sessionId: 'm7-session' });
        await Queue.create({ storeId: store.storeId, branchId: 'default', sessionId: 'm7-session', queueNumber: 1, customerName: 'Customer' });
        const admin = await User.create({ email: 'm7-admin@example.com', passwordHash: await hashPin('admin-password'), name: 'Admin', phone: '-', role: 'PLATFORM_ADMIN', status: 'active', emailVerified: true });
        const support = await User.create({ email: 'm7-support@example.com', passwordHash: await hashPin('support-password'), name: 'Support', phone: '-', role: 'PLATFORM_SUPPORT', status: 'active', emailVerified: true });
        const adminToken = signAccountToken(admin);
        const supportToken = signAccountToken(support);

        await assert.rejects(() => StoreMember.create({ storeId: store.storeId, userId: admin._id, role: 'owner' }), /Platform accounts cannot be store members/);
        assert.equal((await request(baseUrl, '/api/platform/overview', { token: adminToken })).data.totalQueues, 1);
        const stores = await request(baseUrl, '/api/platform/stores', { token: supportToken });
        assert.equal(stores.status, 200);
        assert.equal(stores.data[0].queueCount, 1);
        assert.equal((await request(baseUrl, '/api/platform/revenue', { token: supportToken })).status, 403);
        assert.equal((await request(baseUrl, '/api/platform/packages/pro', { method: 'PUT', token: supportToken, body: { monthlyPrice: 999 } })).status, 403);

        const packageUpdate = await request(baseUrl, '/api/platform/packages/pro', { method: 'PUT', token: adminToken, body: { name: 'Pro', monthlyPrice: 999, features: ['multi-branch'], reason: 'Set launch price' } });
        assert.equal(packageUpdate.status, 200);
        const revenue = await request(baseUrl, '/api/platform/revenue', { token: adminToken });
        assert.equal(revenue.data.monthlyRecurringRevenue, 0);
        assert.equal(revenue.data.byPackage[0].code, 'free');

        const quota = await request(baseUrl, `/api/platform/stores/${store.storeId}/quota`, { method: 'PUT', token: adminToken, body: { limit: 1, reason: 'Temporary abuse control' } });
        assert.equal(quota.status, 200);
        assert.equal(quota.data.limit, null);
        assert.equal(quota.data.unlimited, true);
        assert.equal((await NotificationService.send({ storeId: store.storeId, lineUserId: 'LINE-1', type: 'QUEUE_UPDATED' })).status, 'sent');
        assert.equal((await NotificationService.send({ storeId: store.storeId, lineUserId: 'LINE-1', type: 'QUEUE_UPDATED' })).status, 'sent');
        const errors = await request(baseUrl, '/api/platform/errors', { token: adminToken });
        assert.equal(errors.status, 200);
        assert.ok(errors.data.every(item => item.errorCode !== 'STORE_QUOTA_EXCEEDED'));
        assert.ok(errors.data.every(item => item.lineUserId === undefined));

        assert.equal((await request(baseUrl, `/api/platform/stores/${store.storeId}/impersonate`, { method: 'POST', token: supportToken, body: { reason: 'short' } })).status, 400);
        const impersonation = await request(baseUrl, `/api/platform/stores/${store.storeId}/impersonate`, { method: 'POST', token: supportToken, body: { reason: 'Investigate merchant queue incident' } });
        assert.equal(impersonation.status, 200);
        assert.equal((await request(baseUrl, '/api/store/queues', { token: impersonation.data.token })).status, 200);
        assert.equal((await request(baseUrl, '/api/store/queues', { token: supportToken })).status, 403);
        assert.ok(await PlatformAudit.exists({ action: 'store.impersonate', storeId: store.storeId, actorUserId: support._id }));
        assert.ok(await PlatformAudit.exists({ action: 'quota.disabled', storeId: store.storeId, actorUserId: admin._id }));
    } finally {
        NotificationService.resetTransportForTests();
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect(); await memoryServer.stop();
    }
});
