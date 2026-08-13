const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const Branch = require('../models/Branch');
const Queue = require('../models/Queue');
const StoreSetting = require('../models/StoreSetting');
const QueueSession = require('../models/QueueSession');
const NotificationService = require('../services/notificationService');
const { reserve } = require('../services/queueService');
const { allocateScheduledCallAt, isAutomaticCallWindowOpen, scheduleUnassignedQueues } = require('../services/queueTimingService');
const { runStoreAutomation } = require('../services/queueAutomation');

test('Milestone 10 spaces calls, respects branch hours, and persists optional auto-completion', { timeout: 180000 }, async () => {
    const memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('milestone10-automation'));
    const originalSend = NotificationService.sendForQueue;
    const originalSync = NotificationService.syncQueuePositions;
    const notifications = [];
    NotificationService.sendForQueue = async (queue, type) => {
        notifications.push(`${queue.queueNumber}:${type}`);
        return { status: 'sent' };
    };
    NotificationService.syncQueuePositions = async () => {};

    try {
        const scope = { storeId: 'stable-store', branchId: 'main', sessionId: 'session-1' };
        await Branch.create({ storeId: scope.storeId, branchId: scope.branchId, name: 'Main', slug: 'main', timezone: 'Asia/Bangkok' });
        const settings = await StoreSetting.create({
            storeId: scope.storeId,
            branchId: scope.branchId,
            autoCallEnabled: true,
            autoCallDelayMinutes: 15,
            autoCallIntervalMinutes: 5,
            autoCallScheduleEnabled: true,
            autoCallScheduleStart: '10:00',
            autoCallScheduleEnd: '22:00',
            seatGracePeriodMinutes: 8,
            autoCompleteEnabled: true
        });

        const allocationTime = new Date('2026-08-10T03:00:00.000Z'); // 10:00 Bangkok
        const firstCallAt = await allocateScheduledCallAt(scope.storeId, scope.branchId, settings.toObject(), allocationTime);
        const secondCallAt = await allocateScheduledCallAt(scope.storeId, scope.branchId, settings.toObject(), allocationTime);
        assert.equal(firstCallAt.toISOString(), '2026-08-10T03:15:00.000Z');
        assert.equal(secondCallAt.toISOString(), '2026-08-10T03:20:00.000Z');
        assert.equal(isAutomaticCallWindowOpen(settings, 'Asia/Bangkok', allocationTime), true);
        assert.equal(isAutomaticCallWindowOpen(settings, 'Asia/Bangkok', new Date('2026-08-10T01:00:00.000Z')), false);
        assert.equal(isAutomaticCallWindowOpen({ autoCallScheduleEnabled: true, autoCallScheduleStart: '22:00', autoCallScheduleEnd: '02:00' }, 'Asia/Bangkok', new Date('2026-08-10T16:00:00.000Z')), true);

        await StoreSetting.updateOne({ _id: settings._id }, { $set: { nextAutoCallAt: null } });
        const nextOpeningCall = await allocateScheduledCallAt(
            scope.storeId,
            scope.branchId,
            settings.toObject(),
            new Date('2026-08-10T14:55:00.000Z') // 21:55 Bangkok + 15 minutes
        );
        assert.equal(nextOpeningCall.toISOString(), '2026-08-11T03:00:00.000Z');

        const backfillScope = { ...scope, sessionId: 'backfill-session' };
        const [unscheduledOne, unscheduledTwo] = await Queue.create([
            { ...backfillScope, queueNumber: 1, customerName: 'Unscheduled one' },
            { ...backfillScope, queueNumber: 2, customerName: 'Unscheduled two' },
            { ...backfillScope, queueNumber: 3, customerName: 'Already scheduled', scheduledCallAt: new Date('2026-08-10T03:30:00.000Z') }
        ]);
        const persistedSettings = await StoreSetting.findById(settings._id);
        persistedSettings.nextAutoCallAt = null;
        await persistedSettings.save();
        await scheduleUnassignedQueues(scope.storeId, scope.branchId, backfillScope.sessionId, persistedSettings, allocationTime);
        assert.equal((await Queue.findById(unscheduledOne._id).lean()).scheduledCallAt.toISOString(), '2026-08-10T03:35:00.000Z');
        assert.equal((await Queue.findById(unscheduledTwo._id).lean()).scheduledCallAt.toISOString(), '2026-08-10T03:40:00.000Z');
        assert.equal(persistedSettings.nextAutoCallAt.toISOString(), '2026-08-10T03:40:00.000Z');

        const now = new Date('2026-08-10T04:00:00.000Z');
        const [first, second, dining] = await Queue.create([
            { ...scope, queueNumber: 1, customerName: 'First', scheduledCallAt: new Date(now.getTime() - 2_000) },
            { ...scope, queueNumber: 2, customerName: 'Second', scheduledCallAt: new Date(now.getTime() - 1_000) },
            { ...scope, queueNumber: 3, customerName: 'Dining', status: 'dining', diningDeadlineAt: new Date(now.getTime() - 1_000) }
        ]);
        const concurrent = await Promise.all([
            runStoreAutomation(scope.storeId, scope.branchId, scope.sessionId, now),
            runStoreAutomation(scope.storeId, scope.branchId, scope.sessionId, now)
        ]);
        assert.equal(concurrent.reduce((sum, value) => sum + value, 0), 2); // one call plus one completion
        assert.equal((await Queue.findById(first._id).lean()).status, 'called');
        assert.equal((await Queue.findById(second._id).lean()).status, 'waiting');
        assert.equal((await Queue.findById(dining._id).lean()).status, 'completed');
        assert.equal(notifications.filter(value => value.endsWith(':QUEUE_CALLED')).length, 1);
        assert.equal(notifications.filter(value => value.endsWith(':QUEUE_COMPLETED')).length, 1);

        const fiveMinutesLater = new Date(now.getTime() + 5 * 60_000);
        assert.equal(await runStoreAutomation(scope.storeId, scope.branchId, scope.sessionId, fiveMinutesLater), 1);
        assert.equal((await Queue.findById(second._id).lean()).status, 'called');

        await Branch.create({ storeId: 'idem-store', branchId: 'default', name: 'Idem', slug: 'idem', timezone: 'Asia/Bangkok' });
        await StoreSetting.create({ storeId: 'idem-store', branchId: 'default', queueOpen: true, autoCallEnabled: true, autoCallScheduleEnabled: false });
        await QueueSession.create({ storeId: 'idem-store', branchId: 'default', sessionId: 'idem-session', status: 'active' });
        const replayed = await Promise.all([
            reserve('idem-store', { customerName: 'Same request', pax: 2, idempotencyKey: 'same-key' }),
            reserve('idem-store', { customerName: 'Same request', pax: 2, idempotencyKey: 'same-key' })
        ]);
        assert.equal(await Queue.countDocuments({ storeId: 'idem-store', idempotencyKey: 'same-key' }), 1);
        const idempotentQueue = await Queue.findOne({ storeId: 'idem-store' }).lean();
        assert.ok(idempotentQueue.scheduledCallAt);
        assert.equal(replayed.some(queue => queue.$wasIdempotentReplay), true);
    } finally {
        NotificationService.sendForQueue = originalSend;
        NotificationService.syncQueuePositions = originalSync;
        await mongoose.disconnect();
        await memoryServer.stop();
    }
});
