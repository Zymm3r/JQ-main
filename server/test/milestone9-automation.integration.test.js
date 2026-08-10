const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Queue = require('../models/Queue');
const StoreSetting = require('../models/StoreSetting');
const NotificationService = require('../services/notificationService');
const { runStoreAutomation } = require('../services/queueAutomation');

test('Milestone 9 automation uses persisted deadlines and never infers seating or table completion', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone9-automation'));
    const originalSend = NotificationService.sendForQueue;
    const originalSync = NotificationService.syncQueuePositions;
    NotificationService.sendForQueue = async () => ({ status: 'sent' });
    NotificationService.syncQueuePositions = async () => {};

    try {
        const now = new Date('2026-08-10T10:00:00.000Z');
        const scope = { storeId: 'time-store', branchId: 'default', sessionId: 'session-1' };
        await StoreSetting.create({
            storeId: scope.storeId,
            branchId: scope.branchId,
            autoCallEnabled: true,
            seatGracePeriodMinutes: 5,
            diningTimeLimitMinutes: 90,
            autoCancelNoShowEnabled: false
        });
        const [due, future, expiredCall, overdueDining] = await Queue.create([
            { ...scope, queueNumber: 1, customerName: 'Due', scheduledCallAt: new Date(now.getTime() - 1_000) },
            { ...scope, queueNumber: 2, customerName: 'Future', scheduledCallAt: new Date(now.getTime() + 1_000) },
            { ...scope, queueNumber: 3, customerName: 'Called', status: 'called', calledAt: new Date(now.getTime() - 600_000), seatDeadlineAt: new Date(now.getTime() - 1_000) },
            { ...scope, queueNumber: 4, customerName: 'Dining', status: 'dining', seatedAt: new Date(now.getTime() - 7_200_000), diningDeadlineAt: new Date(now.getTime() - 1_000) }
        ]);

        assert.equal(await runStoreAutomation(scope.storeId, scope.branchId, scope.sessionId, now), 1);
        const calledDue = await Queue.findById(due._id).lean();
        assert.equal(calledDue.status, 'called');
        assert.equal(calledDue.calledAt.toISOString(), now.toISOString());
        assert.equal(calledDue.seatDeadlineAt.toISOString(), new Date(now.getTime() + 5 * 60_000).toISOString());
        assert.equal((await Queue.findById(future._id).lean()).status, 'waiting');
        assert.equal((await Queue.findById(expiredCall._id).lean()).status, 'called');
        assert.equal((await Queue.findById(overdueDining._id).lean()).status, 'dining');

        await StoreSetting.updateOne({ storeId: scope.storeId, branchId: scope.branchId }, { $set: { autoCancelNoShowEnabled: true } });
        assert.equal(await runStoreAutomation(scope.storeId, scope.branchId, scope.sessionId, now), 1);
        const cancelled = await Queue.findById(expiredCall._id).lean();
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(cancelled.cancellationReason, 'seat_timeout');
        assert.equal((await Queue.findById(overdueDining._id).lean()).status, 'dining');
    } finally {
        NotificationService.sendForQueue = originalSend;
        NotificationService.syncQueuePositions = originalSync;
        await mongoose.disconnect();
        await memoryServer.stop();
    }
});
