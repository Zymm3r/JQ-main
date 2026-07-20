const Queue = require('../models/Queue');
const Setting = require('../models/Setting');
const { getSetting } = require('./settingsService');

const DEFAULT_SEAT_DELAY_MINUTES = 1;
let intervalId = null;

async function runStoreAutomation(storeId, sessionId, now) {
    const avgWaitTime = Number.parseFloat(await getSetting(storeId, 'avg_wait_time', '0')) || 0;
    const avgTime = Number.parseFloat(await getSetting(storeId, 'avg_time', '0')) || 0;
    const scope = { storeId, sessionId };
    let updatedCount = 0;

    if (avgWaitTime > 0) {
        const result = await Queue.updateMany(
            { ...scope, status: 'waiting', created_at: { $lte: new Date(now.getTime() - avgWaitTime * 60000) } },
            {
                $set: { status: 'called', calledAt: now },
                $push: { history: { action: 'called', timestamp: now } }
            }
        );
        updatedCount += result.modifiedCount;
    }

    const seated = await Queue.updateMany(
        { ...scope, status: 'called', calledAt: { $lte: new Date(now.getTime() - DEFAULT_SEAT_DELAY_MINUTES * 60000) } },
        {
            $set: { status: 'dining', start_time: now },
            $push: { history: { action: 'seated', timestamp: now } }
        }
    );
    updatedCount += seated.modifiedCount;

    if (avgTime > 0) {
        const completed = await Queue.updateMany(
            { ...scope, status: 'dining', start_time: { $lte: new Date(now.getTime() - avgTime * 60000) } },
            {
                $set: { status: 'completed', end_time: now },
                $push: { history: { action: 'completed', timestamp: now } }
            }
        );
        updatedCount += completed.modifiedCount;
    }

    return updatedCount;
}

async function runAutomationLoop(onUpdateCallback) {
    try {
        const activeSessions = await Setting.find({ key: 'active_session' }).lean();
        for (const setting of activeSessions) {
            const updatedCount = await runStoreAutomation(setting.storeId, setting.value, new Date());
            if (updatedCount > 0 && typeof onUpdateCallback === 'function') {
                await onUpdateCallback(setting.storeId);
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
