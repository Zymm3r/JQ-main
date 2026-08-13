const Queue = require('../models/Queue');
const QueueSession = require('../models/QueueSession');
const StoreSetting = require('../models/StoreSetting');
const Branch = require('../models/Branch');
const NotificationService = require('./notificationService');
const { isAutomaticCallWindowOpen, claimAutomaticCallSlot } = require('./queueTimingService');

const AUTOMATION_POLL_MS = Math.max(1_000, Number(process.env.QUEUE_AUTOMATION_POLL_MS) || 5_000);
const MAX_TRANSITIONS_PER_SESSION = 50;
let timerId = null;
let running = false;
let automationEnabled = false;
const health = {
    running: false,
    enabled: false,
    pollMs: AUTOMATION_POLL_MS,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    nextRunAt: null
};

function addMinutes(date, minutes) {
    return new Date(date.getTime() + minutes * 60_000);
}

async function notifySafely(queue, type) {
    try {
        await NotificationService.sendForQueue(queue, type);
    } catch (error) {
        console.error(`[Automation] ${type} notification failed for queue ${queue._id}:`, error.message);
    }
}

async function callDueQueues(scope, settings, now) {
    const seatGrace = Number(settings.seatGracePeriodMinutes) || 10;
    const due = await Queue.exists({ ...scope, status: 'waiting', scheduledCallAt: { $ne: null, $lte: now } });
    if (!due) return 0;
    // The persisted call slot prevents multiple Railway replicas (or a restart)
    // from collapsing several overdue calls into the same interval.
    const slot = await claimAutomaticCallSlot(scope.storeId, scope.branchId, settings, now);
    if (!slot) return 0;
    const queue = await Queue.findOneAndUpdate(
        { ...scope, status: 'waiting', scheduledCallAt: { $ne: null, $lte: now } },
        {
            $set: {
                status: 'called',
                calledAt: now,
                seatDeadlineAt: addMinutes(now, seatGrace),
                manualAction: false
            },
            $push: { history: { action: 'called', timestamp: now } }
        },
        { new: true, sort: { scheduledCallAt: 1, queueNumber: 1 } }
    );
    if (!queue) return 0;
    await notifySafely(queue, 'QUEUE_CALLED');
    return 1;
}

async function cancelExpiredCalls(scope, settings, now) {
    if (!settings.autoCancelNoShowEnabled) return 0;
    let count = 0;

    while (count < MAX_TRANSITIONS_PER_SESSION) {
        const queue = await Queue.findOneAndUpdate(
            { ...scope, status: 'called', seatDeadlineAt: { $ne: null, $lte: now } },
            {
                $set: {
                    status: 'cancelled',
                    cancelledAt: now,
                    cancellationReason: 'seat_timeout',
                    manualAction: false
                },
                $push: { history: { action: 'cancelled', timestamp: now } }
            },
            { new: true, sort: { seatDeadlineAt: 1, queueNumber: 1 } }
        );
        if (!queue) break;
        count += 1;
        await notifySafely(queue, 'QUEUE_CANCELLED');
    }

    return count;
}

async function completeExpiredDining(scope, settings, now) {
    if (!settings.autoCompleteEnabled) return 0;
    let count = 0;
    while (count < MAX_TRANSITIONS_PER_SESSION) {
        const queue = await Queue.findOneAndUpdate(
            { ...scope, status: 'dining', diningDeadlineAt: { $ne: null, $lte: now } },
            {
                $set: { status: 'completed', completedAt: now, manualAction: false },
                $push: { history: { action: 'completed', timestamp: now } }
            },
            { new: true, sort: { diningDeadlineAt: 1, queueNumber: 1 } }
        );
        if (!queue) break;
        count += 1;
        await notifySafely(queue, 'QUEUE_COMPLETED');
    }
    return count;
}

async function runStoreAutomation(storeId, branchId, sessionId, now = new Date()) {
    const [settings, branch] = await Promise.all([
        StoreSetting.findOne({ storeId, branchId }).lean(),
        Branch.findOne({ storeId, branchId }).lean()
    ]);
    if (!settings) return 0;

    const scope = { storeId, branchId, sessionId };
    const callWindowOpen = isAutomaticCallWindowOpen(settings, branch?.timezone || 'Asia/Bangkok', now);
    const called = settings.autoCallEnabled && callWindowOpen ? await callDueQueues(scope, settings, now) : 0;
    const cancelled = await cancelExpiredCalls(scope, settings, now);
    const completed = await completeExpiredDining(scope, settings, now);
    const updatedCount = called + cancelled + completed;

    if (updatedCount > 0) await NotificationService.syncQueuePositions(storeId, branchId);
    return updatedCount;
}

async function runAutomationLoop(onUpdateCallback, now = new Date()) {
    if (running) return 0;
    running = true;
    health.running = true;
    health.lastRunAt = now;
    let total = 0;
    try {
        await NotificationService.recoverPendingNotifications(now);
        const activeSessions = await QueueSession.find({ status: 'active' }).lean();
        for (const session of activeSessions) {
            const updatedCount = await runStoreAutomation(session.storeId, session.branchId, session.sessionId, now);
            total += updatedCount;
            if (updatedCount > 0 && typeof onUpdateCallback === 'function') {
                await onUpdateCallback(session.storeId, session.branchId);
            }
        }
        health.lastSuccessAt = new Date();
        health.lastError = null;
    } catch (error) {
        console.error('[Automation] Execution error:', error.message);
        health.lastError = String(error.message || error).slice(0, 300);
    } finally {
        running = false;
        health.running = false;
    }
    return total;
}

function startAutomation(onUpdateCallback) {
    if (timerId) return;
    automationEnabled = true;
    health.enabled = true;
    const scheduleNext = () => {
        if (!automationEnabled) return;
        health.nextRunAt = new Date(Date.now() + AUTOMATION_POLL_MS);
        timerId = setTimeout(async () => {
            timerId = null;
            await runAutomationLoop(onUpdateCallback);
            scheduleNext();
        }, AUTOMATION_POLL_MS);
        timerId.unref?.();
    };
    runAutomationLoop(onUpdateCallback).finally(scheduleNext);
}

function stopAutomation() {
    automationEnabled = false;
    health.enabled = false;
    health.nextRunAt = null;
    if (timerId) clearTimeout(timerId);
    timerId = null;
}

function getAutomationHealth() {
    return { ...health };
}

module.exports = {
    startAutomation,
    stopAutomation,
    runAutomationLoop,
    runStoreAutomation,
    callDueQueues,
    completeExpiredDining,
    addMinutes,
    getAutomationHealth
};
