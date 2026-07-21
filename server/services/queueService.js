const crypto = require('crypto');
const Queue = require('../models/Queue');
const Counter = require('../models/Counter');
const StoreSetting = require('../models/StoreSetting');
const { getActiveSession } = require('./queueSessionService');

const ACTIVE_STATUSES = ['waiting', 'called', 'dining'];

function publicQueue(queue) {
    const value = queue.toObject ? queue.toObject() : queue;
    return {
        id: value._id,
        queueNumber: value.queueNumber,
        publicToken: value.publicToken,
        customerName: value.customerName,
        pax: value.pax,
        status: value.status,
        estimatedWaitTime: value.estimatedWaitTime,
        createdAt: value.createdAt,
        calledAt: value.calledAt,
        seatedAt: value.seatedAt,
        completedAt: value.completedAt,
        cancelledAt: value.cancelledAt
    };
}

async function listActiveQueues(storeId, branchId = 'default') {
    const session = await getActiveSession(storeId, branchId);
    return Queue.find({ storeId, branchId, sessionId: session.sessionId, status: { $in: ACTIVE_STATUSES } })
        .sort({ queueNumber: 1 });
}

async function reserve(storeId, input, branchId = 'default') {
    const [session, settings] = await Promise.all([
        getActiveSession(storeId, branchId),
        StoreSetting.findOne({ storeId, branchId }).lean()
    ]);
    if (!settings?.queueOpen) {
        const error = new Error('QUEUE_CLOSED');
        error.statusCode = 409;
        throw error;
    }
    const activeCount = await Queue.countDocuments({
        storeId, branchId, sessionId: session.sessionId, status: { $in: ACTIVE_STATUSES }
    });
    if (activeCount >= settings.maxQueueSize) {
        const error = new Error('QUEUE_FULL');
        error.statusCode = 409;
        throw error;
    }
    if (input.lineUserId) {
        const duplicate = await Queue.exists({
            storeId, branchId, sessionId: session.sessionId, lineUserId: input.lineUserId,
            status: { $in: ACTIVE_STATUSES }
        });
        if (duplicate) {
            const error = new Error('ACTIVE_QUEUE_EXISTS');
            error.statusCode = 409;
            throw error;
        }
    }
    const idempotencyKey = String(input.idempotencyKey || '').trim() || null;
    if (idempotencyKey) {
        const duplicate = await Queue.findOne({ storeId, branchId, sessionId: session.sessionId, idempotencyKey });
        if (duplicate) {
            duplicate.$wasIdempotentReplay = true;
            return duplicate;
        }
    }

    const counter = await Counter.findOneAndUpdate(
        { storeId, branchId, sessionId: session.sessionId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    const estimatedWaitTime = Math.ceil(((activeCount + 1) / settings.totalTables) * settings.averageTableTime);
    try {
        return await Queue.create({
            storeId,
            branchId,
            sessionId: session.sessionId,
            queueNumber: counter.seq,
            publicToken: crypto.randomBytes(24).toString('base64url'),
            source: input.source || 'main',
            idempotencyKey,
            customerName: input.customerName,
            lineUserId: input.lineUserId || null,
            phoneNumber: input.phoneNumber || null,
            pax: input.pax,
            status: 'waiting',
            estimatedWaitTime,
            lastNotifiedQueueAhead: activeCount,
            nearNotificationSentAt: activeCount <= 2 ? new Date() : null,
            history: [{ action: 'reserved' }]
        });
    } catch (error) {
        if (error.code === 11000 && idempotencyKey) {
            const duplicate = await Queue.findOne({ storeId, branchId, sessionId: session.sessionId, idempotencyKey });
            if (duplicate) {
                duplicate.$wasIdempotentReplay = true;
                return duplicate;
            }
        }
        throw error;
    }
}

module.exports = { ACTIVE_STATUSES, publicQueue, listActiveQueues, reserve };
