const crypto = require('crypto');
const QueueSession = require('../models/QueueSession');
const Counter = require('../models/Counter');

async function getActiveSession(storeId, branchId = 'default') {
    const session = await QueueSession.findOne({ storeId, branchId, status: 'active' });
    if (!session) {
        const error = new Error('NO_ACTIVE_SESSION');
        error.statusCode = 409;
        throw error;
    }
    return session;
}

async function createSession(storeId, startedBy = null, branchId = 'default') {
    const sessionId = `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const session = await QueueSession.create({ storeId, branchId, sessionId, startedBy });
    await Counter.create({ storeId, branchId, sessionId, seq: 0 });
    return session;
}

async function resetSession(storeId, startedBy = null, branchId = 'default') {
    const now = new Date();
    await QueueSession.updateMany(
        { storeId, branchId, status: 'active' },
        { $set: { status: 'ended', endedAt: now } }
    );
    return createSession(storeId, startedBy, branchId);
}

module.exports = { getActiveSession, createSession, resetSession };
