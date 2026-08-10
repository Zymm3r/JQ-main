const Queue = require('../models/Queue');
const QueueSession = require('../models/QueueSession');
const StoreSetting = require('../models/StoreSetting');
const NotificationService = require('./notificationService');

const AUTOMATION_POLL_MS = Math.max(1_000, Number(process.env.QUEUE_AUTOMATION_POLL_MS) || 5_000);
const MAX_TRANSITIONS_PER_SESSION = 50;
let timerId = null;
let running = false;
let automationEnabled = false;

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
    let count = 0;
    const seatGrace = Number(settings.seatGracePeriodMinutes) || 10;

    while (count < MAX_TRANSITIONS_PER_SESSION) {
        // The status predicate makes this claim atomic across multiple app replicas.
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
        if (!queue) break;
        count += 1;
        await notifySafely(queue, 'QUEUE_CALLED');
    }

    return count;
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

async function runStoreAutomation(storeId, branchId, sessionId, now = new Date()) {
    const settings = await StoreSetting.findOne({ storeId, branchId }).lean();
    if (!settings?.autoCallEnabled) return 0;

    const scope = { storeId, branchId, sessionId };
    const called = await callDueQueues(scope, settings, now);
    const cancelled = await cancelExpiredCalls(scope, settings, now);
    const updatedCount = called + cancelled;

    // Seating and table completion always require a staff confirmation. Their
    // persisted deadlines are warnings, not inferred physical events.
    if (updatedCount > 0) await NotificationService.syncQueuePositions(storeId, branchId);
    return updatedCount;
}

async function runAutomationLoop(onUpdateCallback, now = new Date()) {
    if (running) return 0;
    running = true;
    let total = 0;
    try {
        const activeSessions = await QueueSession.find({ status: 'active' }).lean();
        for (const session of activeSessions) {
            const updatedCount = await runStoreAutomation(session.storeId, session.branchId, session.sessionId, now);
            total += updatedCount;
            if (updatedCount > 0 && typeof onUpdateCallback === 'function') {
                await onUpdateCallback(session.storeId);
            }
        }
    } catch (error) {
        console.error('[Automation] Execution error:', error.message);
    } finally {
        running = false;
    }
    return total;
}

function startAutomation(onUpdateCallback) {
    if (timerId) return;
    automationEnabled = true;
    const scheduleNext = () => {
        if (!automationEnabled) return;
        timerId = setTimeout(async () => {
            await runAutomationLoop(onUpdateCallback);
            scheduleNext();
        }, AUTOMATION_POLL_MS);
        timerId.unref?.();
    };
    runAutomationLoop(onUpdateCallback).finally(scheduleNext);
}

function stopAutomation() {
    automationEnabled = false;
    if (timerId) clearTimeout(timerId);
    timerId = null;
}

module.exports = { startAutomation, stopAutomation, runAutomationLoop, runStoreAutomation, addMinutes };
