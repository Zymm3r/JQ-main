const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const User = require('../models/User');
const Store = require('../models/Store');
const StoreMember = require('../models/StoreMember');
const Branch = require('../models/Branch');
const Queue = require('../models/Queue');
const StoreSetting = require('../models/StoreSetting');
const QueueSession = require('../models/QueueSession');
const Counter = require('../models/Counter');
const { hashPin } = require('../services/adminAuth');
const { signAccountToken } = require('../services/accountAuth');
const { ensureDefaultBranch } = require('../services/branchService');
const createStoreQueueRoutes = require('../routes/storeQueueRoutes');
const teamRoutes = require('../routes/teamRoutes');
const notificationRoutes = require('../routes/notificationRoutes');
const authRoutes = require('../routes/authRoutes');

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...(options.branchId ? { 'x-branch-id': options.branchId } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, data: await response.json() };
}

async function createUser(email, name) {
    return User.create({ email, passwordHash: await hashPin('password-1234'), name, phone: '0800000000', status: 'active', emailVerified: true });
}

test('Milestone 6 separates staff accounts, enforces permissions and scopes queues by branch', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone6-test'));
    const app = express(); app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use('/api/store', teamRoutes);
    app.use('/api/store', notificationRoutes);
    app.use('/api/store', createStoreQueueRoutes());
    const server = app.listen(0); const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const owner = await createUser('m6-owner@example.com', 'Owner');
        const store = await Store.create({ storeId: 'm6-store', ownerId: owner._id, name: 'M6 Store', slug: 'm6-store', verificationStatus: 'verified', subscriptionStatus: 'active', isActive: true });
        await StoreMember.create({ storeId: store.storeId, userId: owner._id, role: 'owner', status: 'active' });
        await ensureDefaultBranch(store);
        await StoreSetting.create({ storeId: store.storeId, branchId: 'default', queueOpen: true });
        await QueueSession.create({ storeId: store.storeId, branchId: 'default', sessionId: 'default-session', startedBy: owner._id });
        await Counter.create({ storeId: store.storeId, branchId: 'default', sessionId: 'default-session' });
        const ownerToken = signAccountToken(owner, store);
        const automationSettings = await request(baseUrl, '/api/store/settings', {
            method: 'PUT', token: ownerToken,
            body: { autoCallEnabled: true, autoCallDelayMinutes: 20, seatGracePeriodMinutes: 7, diningTimeLimitMinutes: 75, autoCancelNoShowEnabled: false }
        });
        assert.equal(automationSettings.status, 200);
        assert.equal(automationSettings.data.seatGracePeriodMinutes, 7);
        assert.ok(automationSettings.data.serverTime);

        const addStaff = await request(baseUrl, '/api/store/members', { method: 'POST', token: ownerToken, body: { email: 'm6-staff@example.com', password: 'staff-password', name: 'Staff', phone: '0811111111', role: 'staff' } });
        assert.equal(addStaff.status, 201);
        const staffLogin = await request(baseUrl, '/api/auth/login', { method: 'POST', body: { email: 'm6-staff@example.com', password: 'staff-password' } });
        assert.equal(staffLogin.status, 200);
        assert.equal(staffLogin.data.store.membership.role, 'staff');
        assert.ok(staffLogin.data.store.membership.permissions.includes('queue.call'));
        const staffToken = staffLogin.data.token;

        const queue = await Queue.create({ storeId: store.storeId, branchId: 'default', sessionId: 'default-session', queueNumber: 1, customerName: 'Alice' });
        assert.equal((await request(baseUrl, `/api/store/queues/${queue._id}/call`, { method: 'POST', token: staffToken })).status, 200);
        const calledQueue = await Queue.findById(queue._id).lean();
        assert.ok(Math.abs(calledQueue.seatDeadlineAt.getTime() - calledQueue.calledAt.getTime() - 7 * 60_000) < 100);
        const scheduledQueue = await Queue.create({ storeId: store.storeId, branchId: 'default', sessionId: 'default-session', queueNumber: 2, customerName: 'Scheduled' });
        const scheduledAt = new Date(Date.now() + 30 * 60_000);
        assert.equal((await request(baseUrl, `/api/store/queues/${scheduledQueue._id}/schedule`, { method: 'PUT', token: staffToken, body: { scheduledCallAt: scheduledAt } })).status, 200);
        assert.ok(Math.abs((await Queue.findById(scheduledQueue._id).lean()).scheduledCallAt.getTime() - scheduledAt.getTime()) < 100);
        assert.equal((await request(baseUrl, '/api/store/session/reset', { method: 'POST', token: staffToken })).status, 403);
        assert.equal((await request(baseUrl, '/api/store/settings', { method: 'PUT', token: staffToken, body: { queueOpen: false } })).status, 403);

        const viewer = await createUser('m6-viewer@example.com', 'Viewer');
        await StoreMember.create({ storeId: store.storeId, userId: viewer._id, role: 'viewer', status: 'active' });
        const viewerToken = signAccountToken(viewer, store);
        assert.equal((await request(baseUrl, '/api/store/queues', { token: viewerToken })).status, 200);
        assert.equal((await request(baseUrl, `/api/store/queues/${queue._id}/cancel`, { method: 'POST', token: viewerToken })).status, 403);

        const manager = await createUser('m6-manager@example.com', 'Manager');
        await StoreMember.create({ storeId: store.storeId, userId: manager._id, role: 'manager', status: 'active' });
        const managerToken = signAccountToken(manager, store);
        assert.equal((await request(baseUrl, '/api/store/members', { method: 'POST', token: managerToken, body: { email: 'forbidden-owner@example.com', password: 'owner-password', name: 'Bad Owner', phone: '0822222222', role: 'owner' } })).status, 403);
        const branchResponse = await request(baseUrl, '/api/store/branches', { method: 'POST', token: managerToken, body: { name: 'สาขาสอง', slug: 'second', timezone: 'Asia/Bangkok' } });
        assert.equal(branchResponse.status, 201);
        const secondBranchId = branchResponse.data.branchId;
        assert.ok(await StoreSetting.exists({ storeId: store.storeId, branchId: secondBranchId }));
        assert.ok(await QueueSession.exists({ storeId: store.storeId, branchId: secondBranchId, status: 'active' }));

        await Queue.create({ storeId: store.storeId, branchId: secondBranchId, sessionId: (await QueueSession.findOne({ storeId: store.storeId, branchId: secondBranchId })).sessionId, queueNumber: 1, customerName: 'Branch Two' });
        const defaultQueues = await request(baseUrl, '/api/store/queues', { token: ownerToken });
        const secondQueues = await request(baseUrl, '/api/store/queues', { token: ownerToken, branchId: secondBranchId });
        assert.deepEqual(defaultQueues.data.map(item => item.customerName), ['Alice', 'Scheduled']);
        assert.deepEqual(secondQueues.data.map(item => item.customerName), ['Branch Two']);
        assert.equal((await request(baseUrl, '/api/store/queues', { token: ownerToken, branchId: 'branch-from-another-store' })).status, 404);
        assert.equal(await Branch.countDocuments({ storeId: store.storeId, isDefault: true }), 1);
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect(); await memoryServer.stop();
    }
});
