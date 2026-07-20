const express = require('express');
const mongoose = require('mongoose');
const Queue = require('../models/Queue');
const { requireAccount, requireVerifiedAccount } = require('../services/accountAuth');
const { refreshSubscriptionState, subscriptionAllowsQueue } = require('../services/subscriptionService');
const { listActiveQueues } = require('../services/queueService');
const { resetSession } = require('../services/queueSessionService');
const NotificationService = require('../services/notificationService');
const { requirePermission } = require('../services/memberPermissions');
const { requireBranch } = require('../services/branchService');

function createStoreQueueRoutes(onUpdate = null) {
    const router = express.Router();
    // Let the legacy public GET /api/store handler continue to serve its root path.
    router.use((req, res, next) => req.path === '/' ? next('router') : next());
    router.use(requireAccount, requireVerifiedAccount);
    router.use(async (req, res, next) => {
        const store = await refreshSubscriptionState(req.accountStore);
        if (!req.auth.storeId || !store || store.verificationStatus !== 'verified' || !store.isActive || !subscriptionAllowsQueue(store)) {
            return res.status(403).json({ error: 'Active merchant store required' });
        }
        next();
    });
    router.use(requireBranch);

    router.get('/queues', async (req, res) => {
        try {
            res.json(await listActiveQueues(req.auth.storeId, req.auth.branchId));
        } catch (error) {
            if (error.message === 'NO_ACTIVE_SESSION') return res.status(409).json({ error: error.message });
            res.status(500).json({ error: 'Unable to load queues' });
        }
    });

    async function transition(req, res, config) {
        try {
            if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid queue ID' });
            const now = new Date();
            const update = {
                $set: { status: config.nextStatus, ...(config.dateField ? { [config.dateField]: now } : {}) },
                $push: { history: { action: config.historyAction, timestamp: now } }
            };
            const queue = await Queue.findOneAndUpdate(
                { _id: req.params.id, storeId: req.auth.storeId, branchId: req.auth.branchId, status: { $in: config.allowedStatuses } },
                update,
                { new: true }
            );
            if (!queue) return res.status(404).json({ error: 'Queue not found or transition is not allowed' });
            await NotificationService.sendForQueue(queue, config.notificationType);
            await NotificationService.syncQueuePositions(req.auth.storeId, req.auth.branchId);
            if (onUpdate) await onUpdate(req.auth.storeId);
            res.json(queue);
        } catch (error) {
            console.error('Queue transition failed:', error);
            res.status(500).json({ error: 'Unable to update queue' });
        }
    }

    router.post('/queues/:id/call', requirePermission('queue.call'), (req, res) => transition(req, res, {
        allowedStatuses: ['waiting'], nextStatus: 'called', dateField: 'calledAt', historyAction: 'called', notificationType: 'QUEUE_CALLED'
    }));
    router.post('/queues/:id/seat', requirePermission('queue.seat'), (req, res) => transition(req, res, {
        allowedStatuses: ['waiting', 'called'], nextStatus: 'dining', dateField: 'seatedAt', historyAction: 'seated', notificationType: 'QUEUE_UPDATED'
    }));
    router.post('/queues/:id/complete', requirePermission('queue.complete'), (req, res) => transition(req, res, {
        allowedStatuses: ['dining'], nextStatus: 'completed', dateField: 'completedAt', historyAction: 'completed', notificationType: 'QUEUE_COMPLETED'
    }));
    router.post('/queues/:id/cancel', requirePermission('queue.cancel'), (req, res) => transition(req, res, {
        allowedStatuses: ['waiting', 'called'], nextStatus: 'cancelled', dateField: 'cancelledAt', historyAction: 'cancelled', notificationType: 'QUEUE_CANCELLED'
    }));

    router.post('/session/reset', requirePermission('session.reset'), async (req, res) => {
        try {
            await NotificationService.notifyStoreClosed(req.auth.storeId, req.auth.branchId);
            const session = await resetSession(req.auth.storeId, req.account._id, req.auth.branchId);
            if (onUpdate) await onUpdate(req.auth.storeId);
            res.status(201).json({ sessionId: session.sessionId, status: session.status, startedAt: session.startedAt });
        } catch (error) {
            console.error('Session reset failed:', error);
            res.status(500).json({ error: 'Unable to reset session' });
        }
    });

    return router;
}

module.exports = createStoreQueueRoutes;
