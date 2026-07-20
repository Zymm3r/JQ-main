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
const QrSource = require('../models/QrSource');
const { hashPin } = require('../services/adminAuth');
const { signAccountToken } = require('../services/accountAuth');
const qrRoutes = require('../routes/qrRoutes');
const createPublicQueueRoutes = require('../routes/publicQueueRoutes');

async function request(baseUrl, path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: { 'content-type': 'application/json', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    return { status: response.status, data: await response.json() };
}

async function tenant(suffix) {
    const user = await User.create({ email: `m3-${suffix}@example.com`, passwordHash: await hashPin('password-1234'), name: suffix, phone: '0800000000', status: 'active', emailVerified: true });
    const store = await Store.create({ storeId: `m3-${suffix}`, ownerId: user._id, name: `Store ${suffix}`, slug: `store-${suffix}`, liffSlug: `store-${suffix}-a93k`, verificationStatus: 'verified', subscriptionStatus: 'active', isActive: true });
    await StoreSetting.create({ storeId: store.storeId, queueOpen: true });
    await QueueSession.create({ storeId: store.storeId, sessionId: `m3-session-${suffix}` });
    await Counter.create({ storeId: store.storeId, sessionId: `m3-session-${suffix}`, seq: 0 });
    return { user, store, token: signAccountToken(user, store) };
}

test('Milestone 3 creates tenant QR sources and records LIFF reservation source', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone3-test'));
    const app = express(); app.use(express.json());
    app.use('/api/store', qrRoutes);
    app.use('/api/public/stores/:storeSlug', createPublicQueueRoutes());
    const server = app.listen(0); const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const alpha = await tenant('alpha');
        const beta = await tenant('beta');
        const qr = await request(baseUrl, '/api/store/qr', { token: alpha.token });
        assert.equal(qr.status, 200);
        assert.equal(qr.data.store.liffSlug, 'store-alpha-a93k');
        assert.equal(qr.data.sources[0].key, 'main');

        const source = await request(baseUrl, '/api/store/qr-sources', { method: 'POST', token: alpha.token, body: { key: 'front-desk', name: 'Front desk', kind: 'point' } });
        assert.equal(source.status, 201);
        assert.match(source.data.liffUrl, /store-alpha-a93k/);
        assert.match(source.data.liffUrl, /source=front-desk/);

        const info = await request(baseUrl, '/api/public/stores/store-alpha-a93k/info?source=front-desk');
        assert.equal(info.status, 200);
        assert.equal(info.data.name, 'Store alpha');
        assert.equal((await QrSource.findById(source.data.id)).scanCount, 1);

        const reservation = await request(baseUrl, '/api/public/stores/store-alpha-a93k/reserve', { method: 'POST', body: { customerName: 'LIFF Customer', pax: 2, phoneNumber: '0812345678', source: 'front-desk' } });
        assert.equal(reservation.status, 201);
        assert.match(reservation.data.trackingUrl, /\/liff\/store-alpha-a93k\/status\//);
        assert.equal((await Queue.findById(reservation.data.id)).source, 'front-desk');
        assert.equal((await QrSource.findById(source.data.id)).reservationCount, 1);

        const previousNodeEnv = process.env.NODE_ENV;
        const previousLiffId = process.env.LINE_LIFF_ID;
        try {
            process.env.NODE_ENV = 'production';
            process.env.LINE_LIFF_ID = 'configured-liff-id';
            const missingLineLogin = await request(baseUrl, '/api/public/stores/store-alpha-a93k/reserve', { method: 'POST', body: { customerName: 'No LINE session', pax: 1, source: 'front-desk' } });
            assert.equal(missingLineLogin.status, 401);
        } finally {
            if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
            if (previousLiffId === undefined) delete process.env.LINE_LIFF_ID; else process.env.LINE_LIFF_ID = previousLiffId;
        }

        const crossTenantDelete = await request(baseUrl, `/api/store/qr-sources/${source.data.id}`, { method: 'DELETE', token: beta.token });
        assert.equal(crossTenantDelete.status, 404);
        assert.ok(await QrSource.findById(source.data.id));
    } finally {
        await new Promise(resolve => server.close(resolve));
        await mongoose.disconnect(); await memoryServer.stop();
    }
});
