const test = require('node:test');
const assert = require('node:assert/strict');

const Queue = require('../models/Queue');
const Counter = require('../models/Counter');
const Setting = require('../models/Setting');
const LineUser = require('../models/LineUser');
const { DEFAULT_STORE_ID, normalizeStoreId } = require('../config');
const { hashPin, verifyPin, signToken, verifyToken } = require('../services/adminAuth');

function hasUniqueIndex(model, expectedKeys) {
    return model.schema.indexes().some(([keys, options]) =>
        options.unique && JSON.stringify(keys) === JSON.stringify(expectedKeys)
    );
}

test('legacy store remains the default tenant', () => {
    assert.equal(DEFAULT_STORE_ID, 'legacy-store');
    assert.equal(normalizeStoreId(), 'legacy-store');
    assert.throws(() => normalizeStoreId('../other-store'), /INVALID_STORE_ID/);
});

test('queue and counter uniqueness is tenant and branch scoped', () => {
    assert.ok(hasUniqueIndex(Queue, { storeId: 1, branchId: 1, sessionId: 1, queueNumber: 1 }));
    assert.ok(hasUniqueIndex(Counter, { storeId: 1, branchId: 1, sessionId: 1 }));
    assert.ok(hasUniqueIndex(Setting, { storeId: 1, key: 1 }));
    assert.ok(hasUniqueIndex(LineUser, { storeId: 1, lineUserId: 1 }));
});

test('queue schema uses lineUserId and retains the legacy field for migration safety', () => {
    assert.ok(Queue.schema.path('lineUserId'));
    assert.ok(Queue.schema.path('line_id'));
    assert.ok(Queue.schema.path('cancelTokenHash'));
});

test('admin PINs are hashed and tokens are bound to a store', async () => {
    const encoded = await hashPin('a-secure-pin');
    assert.notEqual(encoded, 'a-secure-pin');
    assert.equal(await verifyPin('a-secure-pin', encoded), true);
    assert.equal(await verifyPin('wrong-pin', encoded), false);

    const token = signToken('legacy-store');
    assert.equal(verifyToken(token).storeId, 'legacy-store');
    assert.throws(() => verifyToken(`${token}tampered`), /INVALID_TOKEN/);
});
