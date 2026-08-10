const express = require('express');
const NotificationLog = require('../models/NotificationLog');
const StoreSetting = require('../models/StoreSetting');
const Queue = require('../models/Queue');
const QueueSession = require('../models/QueueSession');
const { requireAccount, requireVerifiedAccount } = require('../services/accountAuth');
const NotificationService = require('../services/notificationService');
const { requirePermission } = require('../services/memberPermissions');
const { requireBranch } = require('../services/branchService');

const router = express.Router();
router.use((req, res, next) => req.path === '/' ? next('router') : next());
router.use(requireAccount, requireVerifiedAccount);
router.use((req, res, next) => {
    if (!req.auth.storeId) return res.status(403).json({ error: 'Merchant store required' });
    next();
});
router.use(requireBranch);

router.get('/notifications/usage', async (req, res) => {
    try {
        res.json(await NotificationService.getUsage(req.auth.storeId));
    } catch (error) {
        res.status(500).json({ error: 'Unable to load notification usage' });
    }
});

router.get('/notifications/logs', async (req, res) => {
    const filter = { storeId: req.auth.storeId };
    if (NotificationLog.TYPES.includes(req.query.type)) filter.type = req.query.type;
    if (['pending', 'sent', 'failed', 'quota_exceeded'].includes(req.query.status)) filter.status = req.query.status;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const logs = await NotificationLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(logs);
});

router.get('/settings', async (req, res) => {
    const settings = await StoreSetting.findOne({ storeId: req.auth.storeId, branchId: req.auth.branchId }).lean();
    if (!settings) return res.status(404).json({ error: 'Store settings not found' });
    res.json({ ...settings, serverTime: new Date().toISOString() });
});

router.put('/settings', requirePermission('settings.update'), async (req, res) => {
    const current = await StoreSetting.findOne({ storeId: req.auth.storeId, branchId: req.auth.branchId });
    if (!current) return res.status(404).json({ error: 'Store settings not found' });
    const wasOpen = current.queueOpen;
    const numeric = [
        ['averageTableTime', 1, 1440], ['averageWaitTime', 0, 1440],
        ['totalTables', 1, 10000], ['maxQueueSize', 1, 100000],
        ['autoCallDelayMinutes', 1, 1440], ['seatGracePeriodMinutes', 1, 1440],
        ['diningTimeLimitMinutes', 1, 1440]
    ];
    for (const [key, min, max] of numeric) {
        if (req.body[key] !== undefined) {
            const value = Number(req.body[key]);
            if (!Number.isFinite(value) || value < min || value > max) return res.status(400).json({ error: `${key} is invalid` });
            current[key] = value;
        }
    }
    if (req.body.autoCallEnabled !== undefined) current.autoCallEnabled = req.body.autoCallEnabled === true;
    if (req.body.autoCancelNoShowEnabled !== undefined) current.autoCancelNoShowEnabled = req.body.autoCancelNoShowEnabled === true;
    if (req.body.queueOpen !== undefined) current.queueOpen = req.body.queueOpen === true;
    if (req.body.businessHours !== undefined) {
        if (!Array.isArray(req.body.businessHours) || req.body.businessHours.length > 7) return res.status(400).json({ error: 'businessHours is invalid' });
        current.businessHours = req.body.businessHours;
    }
    await current.save();
    if (current.autoCallEnabled) {
        const session = await QueueSession.findOne({ storeId: req.auth.storeId, branchId: req.auth.branchId, status: 'active' }).lean();
        if (session) {
            const delayMs = current.autoCallDelayMinutes * 60_000;
            await Queue.updateMany(
                {
                    storeId: req.auth.storeId,
                    branchId: req.auth.branchId,
                    sessionId: session.sessionId,
                    status: 'waiting',
                    scheduledCallAt: null
                },
                [{ $set: { scheduledCallAt: { $add: ['$createdAt', delayMs] } } }]
            );
        }
    }
    if (wasOpen && !current.queueOpen) await NotificationService.notifyStoreClosed(req.auth.storeId, req.auth.branchId);
    res.json({ ...current.toObject(), serverTime: new Date().toISOString() });
});

module.exports = router;
