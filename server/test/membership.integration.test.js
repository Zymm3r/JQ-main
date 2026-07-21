const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const authRoutes = require('../routes/authRoutes');
const merchantRoutes = require('../routes/merchantRoutes');
const platformRoutes = require('../routes/platformRoutes');
const User = require('../models/User');
const Store = require('../models/Store');
const { hashPin } = require('../services/adminAuth');

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, data: await response.json() };
}

test('merchant registration, verification, store submission and approval work end-to-end', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('membership-test'));
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    app.use('/api/merchant', merchantRoutes);
    app.use('/api/platform', platformRoutes);
    const server = app.listen(0);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const registration = await request(baseUrl, '/api/auth/register', {
            method: 'POST',
            body: { email: 'owner@example.com', password: 'very-secure-password', name: 'Owner', phone: '0812345678', acceptedTerms: true }
        });
        assert.equal(registration.status, 201);
        assert.match(registration.data.store.storeId, /^store-[a-f0-9-]+$/);
        assert.equal(registration.data.store.verificationStatus, 'draft');
        assert.equal(registration.data.store.isActive, false);
        assert.match(registration.data.devVerificationCode, /^\d{6}$/);

        const rejectedSetup = await request(baseUrl, '/api/merchant/store', {
            method: 'PUT', token: registration.data.token, body: { name: 'Store' }
        });
        assert.equal(rejectedSetup.status, 403);

        const verification = await request(baseUrl, '/api/auth/verify-email', {
            method: 'POST', token: registration.data.token, body: { code: registration.data.devVerificationCode }
        });
        assert.equal(verification.status, 200);
        assert.equal(verification.data.user.emailVerified, true);

        const setup = await request(baseUrl, '/api/merchant/store', {
            method: 'PUT',
            token: registration.data.token,
            body: {
                name: 'Queue Restaurant', slug: 'queue-restaurant', phone: '0812345678', address: 'Bangkok',
                googleMapsUrl: 'https://maps.google.com/example', storefrontPhotoUrl: 'https://example.com/store.jpg',
                onlineChannelUrl: 'https://facebook.com/example', proofUrls: ['https://example.com/proof.jpg'], acceptedTerms: true
            }
        });
        assert.equal(setup.status, 200);
        assert.equal(setup.data.slug, 'queue-restaurant');

        const submission = await request(baseUrl, '/api/merchant/store/submit', {
            method: 'POST', token: registration.data.token
        });
        assert.equal(submission.status, 200);
        assert.equal(submission.data.verificationStatus, 'pending_verification');
        assert.equal(submission.data.subscriptionStatus, 'active');
        assert.equal(submission.data.isActive, false);

        const admin = await User.create({
            email: 'admin@example.com', passwordHash: await hashPin('admin-password'), name: 'Admin', phone: '-',
            role: 'platform_admin', status: 'active', emailVerified: true
        });
        assert.ok(admin._id);
        const adminLogin = await request(baseUrl, '/api/auth/login', {
            method: 'POST', body: { email: 'admin@example.com', password: 'admin-password' }
        });
        assert.equal(adminLogin.status, 200);

        const pending = await request(baseUrl, '/api/platform/stores?status=pending_verification', {
            method: 'GET', token: adminLogin.data.token
        });
        assert.equal(pending.status, 200);
        assert.equal(pending.data.length, 1);

        const approval = await request(baseUrl, `/api/platform/stores/${registration.data.store.storeId}/decision`, {
            method: 'POST', token: adminLogin.data.token, body: { action: 'approve' }
        });
        assert.equal(approval.status, 200);
        assert.equal(approval.data.store.verificationStatus, 'verified');
        assert.equal(approval.data.store.isActive, true);

        const stored = await Store.findOne({ storeId: registration.data.store.storeId }).lean();
        assert.equal(stored.ownerId.toString(), registration.data.user.id);
        assert.equal(stored.subscriptionStatus, 'active');
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect();
        await memoryServer.stop();
    }
});
