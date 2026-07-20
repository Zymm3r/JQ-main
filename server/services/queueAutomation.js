const Queue = require('../models/Queue');
const QueueSession = require('../models/QueueSession');
const StoreSetting = require('../models/StoreSetting');
const NotificationService = require('./notificationService');

const DEFAULT_SEAT_DELAY_MINUTES = 1;
let intervalId = null;

async function runStoreAutomation(storeId, branchId, sessionId, now) {
    const settings = await StoreSetting.findOne({ storeId, branchId }).lean();
    if (!settings?.autoCallEnabled) return 0;
    const avgWaitTime = settings.averageWaitTime || 0;
    const avgTime = settings.averageTableTime || 0;
    const scope = { storeId, branchId, sessionId };
    let updatedCount = 0;

    async function transitionMany(filter, status, dateField, historyAction, notificationType) {
        const queues = await Queue.find(filter);
        for (const queue of queues) {
            queue.status = status;
            queue[dateField] = now;
            queue.history.push({ action: historyAction, timestamp: now });
            await queue.save();
            await NotificationService.sendForQueue(queue, notificationType);
        }
        return queues.length;
    }

    if (avgWaitTime > 0) {
        updatedCount += await transitionMany(
            { ...scope, status: 'waiting', createdAt: { $lte: new Date(now.getTime() - avgWaitTime * 60000) } },
            'called', 'calledAt', 'called', 'QUEUE_CALLED'
        );
    }

    updatedCount += await transitionMany(
        { ...scope, status: 'called', calledAt: { $lte: new Date(now.getTime() - DEFAULT_SEAT_DELAY_MINUTES * 60000) } },
        'dining', 'seatedAt', 'seated', 'QUEUE_UPDATED'
    );

    if (avgTime > 0) {
        updatedCount += await transitionMany(
            { ...scope, status: 'dining', seatedAt: { $lte: new Date(now.getTime() - avgTime * 60000) } },
            'completed', 'completedAt', 'completed', 'QUEUE_COMPLETED'
        );
    }

    if (updatedCount > 0) await NotificationService.syncQueuePositions(storeId, branchId);

    return updatedCount;
}

async function runAutomationLoop(onUpdateCallback) {
    try {
        const activeSessions = await QueueSession.find({ status: 'active' }).lean();
        for (const session of activeSessions) {
            const updatedCount = await runStoreAutomation(session.storeId, session.branchId, session.sessionId, new Date());
            if (updatedCount > 0 && typeof onUpdateCallback === 'function') {
                await onUpdateCallback(session.storeId);
            }
        }
    } catch (error) {
        console.error('[Automation] Execution error:', error.message);
    }
}

function startAutomation(onUpdateCallback) {
    if (intervalId) return;
    runAutomationLoop(onUpdateCallback);
    intervalId = setInterval(() => runAutomationLoop(onUpdateCallback), 60000);
}

module.exports = { startAutomation, runAutomationLoop };
