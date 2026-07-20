const express = require('express');
const Store = require('../models/Store');
const Queue = require('../models/Queue');
const { refreshSubscriptionState, subscriptionAllowsQueue } = require('../services/subscriptionService');
const { publicQueue, reserve } = require('../services/queueService');
const StoreSetting = require('../models/StoreSetting');
const QrSource = require('../models/QrSource');
const { normalizeSource } = require('../services/liffService');
const { resolveLineIdentity } = require('../services/lineLiffAuth');
const NotificationService = require('../services/notificationService');
const { resolveBranch } = require('../services/branchService');

function createPublicQueueRoutes(onUpdate = null) {
    const router = express.Router({ mergeParams: true });

    router.use(async (req, res, next) => {
        try {
            const slug = String(req.params.storeSlug || '').trim().toLowerCase();
            const store = await refreshSubscriptionState(await Store.findOne({ $or: [{ slug }, { liffSlug: slug }] }));
            if (!store) return res.status(404).json({ error: 'Store not found' });
            req.publicStore = store;
            req.publicBranch = await resolveBranch(store);
            next();
        } catch (error) {
            res.status(500).json({ error: 'Unable to validate store' });
        }
    });

    router.get('/info', async (req, res) => {
        let source;
        try {
            source = normalizeSource(req.query.source);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
        const [settings, qrSource] = await Promise.all([
            StoreSetting.findOne({ storeId: req.publicStore.storeId, branchId: req.publicBranch.branchId }).lean(),
            QrSource.findOneAndUpdate(
                { storeId: req.publicStore.storeId, key: source, active: true },
                { $inc: { scanCount: 1 }, $set: { lastScannedAt: new Date() } },
                { new: true }
            )
        ]);
        if (!qrSource && source !== 'main') return res.status(404).json({ error: 'QR source not found' });
        res.json({
            name: req.publicStore.name,
            logoUrl: req.publicStore.logoUrl,
            description: req.publicStore.description,
            liffSlug: req.publicStore.liffSlug,
            source,
            sourceName: qrSource?.name || 'QR หลักของร้าน',
            queueOpen: Boolean(settings?.queueOpen),
            liffId: String(process.env.LINE_LIFF_ID || '').trim() || null
        });
    });

    router.post('/reserve', async (req, res) => {
        if (req.publicStore.verificationStatus !== 'verified' || !req.publicStore.isActive || !subscriptionAllowsQueue(req.publicStore)) {
            return res.status(403).json({ error: 'Store queue is not active' });
        }
        const customerName = String(req.body.customerName || req.body.name || '').trim();
        const phoneNumber = String(req.body.phoneNumber || req.body.phone || '').trim() || null;
        const pax = Number(req.body.pax ?? 1);
        if (!customerName || customerName.length > 120) return res.status(400).json({ error: 'Customer name is required' });
        if (!Number.isSafeInteger(pax) || pax < 1 || pax > 100) return res.status(400).json({ error: 'Pax must be an integer from 1 to 100' });
        if (phoneNumber && phoneNumber.length > 30) return res.status(400).json({ error: 'Phone number is too long' });

        try {
            const source = normalizeSource(req.body.source);
            const sourceRecord = await QrSource.findOne({ storeId: req.publicStore.storeId, key: source, active: true });
            if (!sourceRecord && source !== 'main') return res.status(404).json({ error: 'QR source not found' });
            const identity = await resolveLineIdentity(req);
            const queue = await reserve(req.publicStore.storeId, {
                customerName: customerName || identity.displayName,
                phoneNumber,
                lineUserId: identity.lineUserId,
                pax,
                source
            }, req.publicBranch.branchId);
            await NotificationService.sendForQueue(queue, 'QUEUE_RESERVED', {
                queueAhead: queue.lastNotifiedQueueAhead,
                estimatedWaitTime: queue.estimatedWaitTime
            });
            if (sourceRecord) await QrSource.updateOne({ _id: sourceRecord._id }, { $inc: { reservationCount: 1 } });
            if (onUpdate) await onUpdate(req.publicStore.storeId);
            const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
            res.status(201).json({
                ...publicQueue(queue),
                trackingUrl: `${appBaseUrl}/liff/${encodeURIComponent(req.publicStore.liffSlug)}/status/${encodeURIComponent(queue.publicToken)}`
            });
        } catch (error) {
            const known = ['NO_ACTIVE_SESSION', 'QUEUE_CLOSED', 'QUEUE_FULL', 'ACTIVE_QUEUE_EXISTS', 'LINE_LOGIN_REQUIRED', 'INVALID_LINE_SESSION'];
            if (known.includes(error.message)) return res.status(error.statusCode || 409).json({ error: error.message });
            if (error.code === 11000) return res.status(409).json({ error: 'QUEUE_CONFLICT' });
            console.error('Public reservation failed:', error);
            res.status(500).json({ error: 'Unable to reserve queue' });
        }
    });

    router.get('/status/:publicToken', async (req, res) => {
        const queue = await Queue.findOne({
            storeId: req.publicStore.storeId,
            branchId: req.publicBranch.branchId,
            publicToken: req.params.publicToken
        });
        if (!queue) return res.status(404).json({ error: 'Queue not found' });
        res.json(publicQueue(queue));
    });

    router.post('/status/:publicToken/cancel', async (req, res) => {
        const queue = await Queue.findOneAndUpdate(
            {
                storeId: req.publicStore.storeId,
                branchId: req.publicBranch.branchId,
                publicToken: req.params.publicToken,
                status: { $in: ['waiting', 'called'] }
            },
            {
                $set: { status: 'cancelled', cancelledAt: new Date(), manualAction: true },
                $push: { history: { action: 'cancelled', timestamp: new Date() } }
            },
            { new: true }
        );
        if (!queue) return res.status(404).json({ error: 'Queue not found or cannot be cancelled' });
        await NotificationService.sendForQueue(queue, 'QUEUE_CANCELLED');
        await NotificationService.syncQueuePositions(req.publicStore.storeId, req.publicBranch.branchId);
        if (onUpdate) await onUpdate(req.publicStore.storeId);
        res.json(publicQueue(queue));
    });

    return router;
}

module.exports = createPublicQueueRoutes;
