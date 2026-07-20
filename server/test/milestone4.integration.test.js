const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Store = require('../models/Store');
const StoreSetting = require('../models/StoreSetting');
const QueueSession = require('../models/QueueSession');
const Counter = require('../models/Counter');
const Queue = require('../models/Queue');
const NotificationLog = require('../models/NotificationLog');
const NotificationUsage = require('../models/NotificationUsage');
const NotificationService = require('../services/notificationService');
const { hashPin } = require('../services/adminAuth');
const { signAccountToken } = require('../services/accountAuth');
const createStoreQueueRoutes = require('../routes/storeQueueRoutes');
const notificationRoutes = require('../routes/notificationRoutes');
const platformRoutes = require('../routes/platformRoutes');

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, data: await response.json() };
}

test('Milestone 4 central notifications provide Flex messages, lifecycle logs, retries, unlimited usage and reports', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone4-test'));
    const sent = [];
    NotificationService.setTransportForTests(async (lineUserId, message) => { sent.push({ lineUserId, message }); return { ok: true }; });

    const app = express(); app.use(express.json());
    app.use('/api/store', notificationRoutes);
    app.use('/api/store', createStoreQueueRoutes());
    app.use('/api/platform', platformRoutes);
    const server = app.listen(0); const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const owner = await User.create({ email: 'm4-owner@example.com', passwordHash: await hashPin('password-1234'), name: 'Owner', phone: '0800000000', status: 'active', emailVerified: true });
        const store = await Store.create({ storeId: 'm4-store', ownerId: owner._id, name: 'Shabu Q', slug: 'shabu-q', liffSlug: 'shabu-q-a93k', verificationStatus: 'verified', subscriptionStatus: 'trial', plan: 'business', isActive: true });
        await StoreSetting.create({ storeId: store.storeId, queueOpen: true, totalTables: 10, averageTableTime: 30 });
        await QueueSession.create({ storeId: store.storeId, sessionId: 'm4-session', startedBy: owner._id });
        await Counter.create({ storeId: store.storeId, sessionId: 'm4-session', seq: 3 });
        const queue1 = await Queue.create({ storeId: store.storeId, sessionId: 'm4-session', queueNumber: 1, publicToken: 'm4-public-one', customerName: 'Alice', lineUserId: 'LINE-A', status: 'waiting', estimatedWaitTime: 9, lastNotifiedQueueAhead: 5 });
        const queue2 = await Queue.create({ storeId: store.storeId, sessionId: 'm4-session', queueNumber: 2, publicToken: 'm4-public-two', customerName: 'Bob', lineUserId: 'LINE-B', status: 'waiting', estimatedWaitTime: 12, lastNotifiedQueueAhead: 5 });
        const merchantToken = signAccountToken(owner, store);

        const reserved = await NotificationService.sendForQueue(queue1, 'QUEUE_RESERVED', { queueAhead: 4 });
        assert.equal(reserved.status, 'sent');
        assert.equal(reserved.message.type, 'flex');
        const flexText = JSON.stringify(reserved.message);
        assert.match(flexText, /Shabu Q/);
        assert.match(flexText, /Q1/);
        assert.match(flexText, /Waiting/);
        assert.match(flexText, /View queue status/);
        assert.match(flexText, /Cancel queue/);
        assert.match(flexText, /central queue platform/);
        assert.match(flexText, /Sent \d{4}-\d{2}-\d{2}T/);
        const completedFlex = JSON.stringify(NotificationService.buildFlexMessage(store.toObject(), 'QUEUE_COMPLETED', { queueNumber: 1, publicToken: queue1.publicToken, status: 'completed', cancellationPossible: false }));
        assert.match(completedFlex, /View queue status/);
        assert.doesNotMatch(completedFlex, /Cancel queue/);

        let retryAttempts = 0;
        NotificationService.setTransportForTests(async () => {
            retryAttempts += 1;
            if (retryAttempts === 1) throw Object.assign(new Error('temporary outage'), { statusCode: 503 });
            return { ok: true };
        });
        const retried = await NotificationService.sendForQueue(queue1, 'QUEUE_UPDATED', { queueAhead: 3 });
        assert.equal(retried.status, 'sent');
        assert.equal(retried.log.retryCount, 1);
        assert.equal(retried.log.errorCode, 'HTTP_503');

        NotificationService.setTransportForTests(async () => { throw Object.assign(new Error('bad recipient'), { statusCode: 400, code: 'INVALID_LINE_USER' }); });
        const permanentFailure = await NotificationService.sendForQueue(queue1, 'QUEUE_UPDATED', { queueAhead: 3 });
        assert.equal(permanentFailure.status, 'failed');
        assert.equal(permanentFailure.log.retryCount, 0);
        assert.equal(permanentFailure.log.errorCode, 'INVALID_LINE_USER');
        assert.equal(permanentFailure.retryNeeded, false);
        assert.equal(permanentFailure.log.retryNeeded, false);

        NotificationService.setTransportForTests(async () => { throw Object.assign(new Error('LINE unavailable'), { statusCode: 503 }); });
        const exhaustedRetry = await NotificationService.sendForQueue(queue1, 'QUEUE_UPDATED', { queueAhead: 3 });
        assert.equal(exhaustedRetry.status, 'failed');
        assert.equal(exhaustedRetry.log.retryCount, 2);
        assert.equal(exhaustedRetry.retryNeeded, true);
        assert.equal(exhaustedRetry.log.retryNeeded, true);

        NotificationService.setTransportForTests(async (lineUserId, message) => { sent.push({ lineUserId, message }); return { ok: true }; });
        const call = await request(baseUrl, `/api/store/queues/${queue1._id}/call`, { method: 'POST', token: merchantToken });
        assert.equal(call.status, 200);
        const seat = await request(baseUrl, `/api/store/queues/${queue1._id}/seat`, { method: 'POST', token: merchantToken });
        assert.equal(seat.status, 200);
        const complete = await request(baseUrl, `/api/store/queues/${queue1._id}/complete`, { method: 'POST', token: merchantToken });
        assert.equal(complete.status, 200);
        const cancel = await request(baseUrl, `/api/store/queues/${queue2._id}/cancel`, { method: 'POST', token: merchantToken });
        assert.equal(cancel.status, 200);

        const queue3 = await Queue.create({ storeId: store.storeId, sessionId: 'm4-session', queueNumber: 3, publicToken: 'm4-public-three', customerName: 'Cara', lineUserId: 'LINE-C', status: 'waiting', lastNotifiedQueueAhead: 0 });
        const close = await request(baseUrl, '/api/store/settings', { method: 'PUT', token: merchantToken, body: { queueOpen: false } });
        assert.equal(close.status, 200);
        assert.equal(close.data.queueOpen, false);

        const deliveredTypes = new Set((await NotificationLog.find({ storeId: store.storeId, status: 'sent' }).lean()).map(log => log.type));
        for (const type of NotificationLog.TYPES) assert.ok(deliveredTypes.has(type), `missing delivered ${type}`);

        const usageApi = await request(baseUrl, '/api/store/notifications/usage', { token: merchantToken });
        assert.equal(usageApi.status, 200);
        assert.equal(usageApi.data.plan, 'trial');
        assert.equal(usageApi.data.limit, null);
        assert.equal(usageApi.data.unlimited, true);
        assert.equal(usageApi.data.remaining, null);
        assert.equal(usageApi.data.count, await NotificationLog.countDocuments({ storeId: store.storeId }));
        const logsApi = await request(baseUrl, '/api/store/notifications/logs?limit=100', { token: merchantToken });
        assert.equal(logsApi.status, 200);
        assert.ok(logsApi.data.every(log => log.storeId === store.storeId));

        await NotificationUsage.updateOne({ storeId: store.storeId, period: NotificationService.periodFor() }, { $set: { count: 100000 } });
        const beforeUnlimitedTransportCount = sent.length;
        const unlimitedSend = await NotificationService.sendForQueue(queue3, 'QUEUE_UPDATED');
        assert.equal(unlimitedSend.status, 'sent');
        assert.equal(sent.length, beforeUnlimitedTransportCount + 1);
        assert.equal(unlimitedSend.usage.count, 100001);
        assert.equal(await NotificationLog.countDocuments({ storeId: store.storeId, status: 'quota_exceeded' }), 0);

        const businessStore = await Store.create({ storeId: 'm4-business', name: 'Business Store', slug: 'business', liffSlug: 'business-b1234', verificationStatus: 'verified', subscriptionStatus: 'active', plan: 'business', isActive: true });
        const businessUsage = await NotificationService.getUsage(businessStore.storeId);
        assert.equal(businessUsage.limit, null);
        assert.equal(businessUsage.unlimited, true);

        const admin = await User.create({ email: 'm4-admin@example.com', passwordHash: await hashPin('admin-password'), name: 'Admin', phone: '-', role: 'platform_admin', status: 'active', emailVerified: true });
        const summary = await request(baseUrl, '/api/platform/notifications/summary', { token: signAccountToken(admin) });
        assert.equal(summary.status, 200);
        assert.equal(summary.data.topStores[0].storeId, store.storeId);
        assert.ok(summary.data.retryStats.some(item => item.retries >= 1));
    } finally {
        NotificationService.resetTransportForTests();
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect(); await memoryServer.stop();
    }
});
