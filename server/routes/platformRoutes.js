const express = require('express');
const Store = require('../models/Store');
const StoreReview = require('../models/StoreReview');
const Queue = require('../models/Queue');
const NotificationUsage = require('../models/NotificationUsage');
const NotificationLog = require('../models/NotificationLog');
const PlatformPackage = require('../models/PlatformPackage');
const PlatformAudit = require('../models/PlatformAudit');
const { requireAccount, requirePlatformAdmin, signImpersonationToken } = require('../services/accountAuth');
const { requirePlatformPermission } = require('../services/platformPermissions');
const { ensureStoreQueueSettings } = require('../services/storeProvisioning');
const { periodFor } = require('../services/notificationService');

const router = express.Router();
router.use(requireAccount, requirePlatformAdmin);
router.use(requirePlatformPermission('platform.view'));

async function audit(req, action, { storeId = null, reason, metadata = {} }) {
    return PlatformAudit.create({
        actorUserId: req.account._id,
        actorRole: req.account.role,
        action,
        storeId,
        reason: String(reason || action).trim().slice(0, 2000),
        metadata,
        ip: req.ip || null,
        userAgent: String(req.get('user-agent') || '').slice(0, 500) || null
    });
}

router.get('/overview', async (req, res) => {
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : periodFor();
    const [stores, queueCounts, messageCounts, failedMessages, activeStores] = await Promise.all([
        Store.countDocuments(),
        Queue.aggregate([{ $group: { _id: '$storeId', count: { $sum: 1 } } }]),
        NotificationUsage.aggregate([{ $match: { period } }, { $group: { _id: null, count: { $sum: '$count' } } }]),
        NotificationLog.countDocuments({ period, status: 'failed' }),
        Store.countDocuments({ verificationStatus: 'verified', isActive: true })
    ]);
    res.json({
        period,
        stores,
        totalQueues: queueCounts.reduce((sum, item) => sum + item.count, 0),
        lineMessages: messageCounts[0]?.count || 0,
        failedMessages,
        activeStores,
        activeSubscriptions: activeStores
    });
});

router.get('/stores', async (req, res) => {
    const allowedStatuses = ['draft', 'pending_verification', 'verified', 'rejected', 'suspended'];
    const filter = allowedStatuses.includes(req.query.status) ? { verificationStatus: req.query.status } : {};
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : periodFor();
    const stores = await Store.find(filter).populate('ownerId', 'email name phone status emailVerified').sort({ createdAt: -1 }).limit(500).lean();
    const storeIds = stores.map(store => store.storeId);
    const [queueCounts, usage] = await Promise.all([
        Queue.aggregate([{ $match: { storeId: { $in: storeIds } } }, { $group: { _id: '$storeId', count: { $sum: 1 } } }]),
        NotificationUsage.find({ storeId: { $in: storeIds }, period }).lean()
    ]);
    const queuesByStore = new Map(queueCounts.map(item => [item._id, item.count]));
    const usageByStore = new Map(usage.map(item => [item.storeId, item.count]));
    res.json(stores.map(store => ({ ...store, queueCount: queuesByStore.get(store.storeId) || 0, lineMessageCount: usageByStore.get(store.storeId) || 0 })));
});

router.post('/stores/:storeId/decision', requirePlatformPermission('stores.review'), async (req, res) => {
    const action = String(req.body.action || '');
    const message = String(req.body.message || '').trim().slice(0, 2000) || null;
    if (!['approve', 'reject', 'request_more_info', 'suspend'].includes(action)) return res.status(400).json({ error: 'Invalid review action' });
    if (['reject', 'request_more_info', 'suspend'].includes(action) && !message) return res.status(400).json({ error: 'A reason or request message is required' });
    const store = await Store.findOne({ storeId: req.params.storeId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const now = new Date();
    if (action === 'approve') {
        if (store.verificationStatus !== 'pending_verification') return res.status(409).json({ error: 'Store is not pending verification' });
        store.verificationStatus = 'verified';
        store.isActive = true;
        store.rejectionReason = null; store.informationRequest = null;
        await ensureStoreQueueSettings(store);
    } else if (action === 'reject') {
        store.verificationStatus = 'rejected'; store.isActive = false; store.rejectionReason = message; store.informationRequest = null;
    } else if (action === 'request_more_info') {
        store.verificationStatus = 'draft'; store.isActive = false; store.informationRequest = message; store.rejectionReason = null;
    } else {
        store.verificationStatus = 'suspended'; store.isActive = false; store.informationRequest = message;
    }
    store.reviewedAt = now; store.reviewedBy = req.account._id;
    await store.save();
    await Promise.all([
        StoreReview.create({ storeId: store.storeId, reviewerId: req.account._id, action, message }),
        audit(req, `store.${action}`, { storeId: store.storeId, reason: message || `Store ${action}` })
    ]);
    res.json({ success: true, store });
});

router.get('/subscriptions', async (req, res) => {
    res.json(await Store.find().select('storeId name plan subscriptionStatus trialEndsAt subscriptionEndsAt isActive notificationQuotaOverride').sort({ updatedAt: -1 }).lean());
});

router.put('/stores/:storeId/subscription', requirePlatformPermission('subscriptions.manage'), async (req, res) => {
    const plans = ['basic', 'starter', 'pro', 'business'];
    if (req.body.plan && !plans.includes(req.body.plan)) return res.status(400).json({ error: 'Invalid package' });
    const store = await Store.findOne({ storeId: req.params.storeId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const before = { status: store.subscriptionStatus, plan: store.plan };
    store.subscriptionStatus = 'active';
    store.plan = req.body.plan || store.plan || 'basic';
    store.subscriptionEndsAt = null;
    if (store.verificationStatus === 'verified') store.isActive = true;
    await store.save();
    await audit(req, 'subscription.disabled', { storeId: store.storeId, reason: req.body.reason || 'Subscription controls are disabled', metadata: { before, after: { status: store.subscriptionStatus, plan: store.plan } } });
    res.json({ success: true, store });
});

router.put('/stores/:storeId/quota', requirePlatformPermission('quota.manage'), async (req, res) => {
    const store = await Store.findOneAndUpdate({ storeId: req.params.storeId }, { $set: { notificationQuotaOverride: null } }, { new: true, runValidators: true });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    await audit(req, 'quota.disabled', { storeId: store.storeId, reason: req.body.reason || 'Notification quota controls are disabled', metadata: { limit: null } });
    res.json({ storeId: store.storeId, limit: null, unlimited: true });
});

router.get('/errors', async (req, res) => {
    const filter = { $or: [{ status: 'failed' }, { retryNeeded: true }, { errorCode: { $nin: [null, ''] } }] };
    if (req.query.storeId) filter.storeId = String(req.query.storeId);
    res.json(await NotificationLog.find(filter).select('-lineUserId').sort({ createdAt: -1 }).limit(200).lean());
});

router.get('/notifications/summary', async (req, res) => {
    const period = /^\d{4}-\d{2}$/.test(String(req.query.period || '')) ? req.query.period : periodFor();
    const [topStores, errors, retryStats, statusCounts, retryNeeded] = await Promise.all([
        NotificationUsage.find({ period }).sort({ count: -1 }).limit(100).lean(),
        NotificationLog.aggregate([{ $match: { period, errorCode: { $nin: [null, ''] } } }, { $group: { _id: '$errorCode', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 50 }]),
        NotificationLog.aggregate([{ $match: { period, retryCount: { $gt: 0 } } }, { $group: { _id: '$status', notifications: { $sum: 1 }, retries: { $sum: '$retryCount' } } }]),
        NotificationLog.aggregate([{ $match: { period } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
        NotificationLog.countDocuments({ period, retryNeeded: true })
    ]);
    res.json({ period, topStores, errors, retryStats, statusCounts, retryNeeded });
});

router.post('/stores/:storeId/impersonate', requirePlatformPermission('stores.impersonate'), async (req, res) => {
    const reason = String(req.body.reason || '').trim();
    if (reason.length < 10) return res.status(400).json({ error: 'A detailed impersonation reason is required' });
    const store = await Store.findOne({ storeId: req.params.storeId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const record = await audit(req, 'store.impersonate', { storeId: store.storeId, reason, metadata: { expiresInMinutes: 30 } });
    res.json({ token: signImpersonationToken(req.account, store, record._id), storeId: store.storeId, auditId: record._id, expiresIn: 1800 });
});

router.get('/revenue', requirePlatformPermission('revenue.view'), async (req, res) => {
    const stores = await Store.countDocuments({ verificationStatus: 'verified', isActive: true });
    res.json({ currency: 'THB', monthlyRecurringRevenue: 0, byPackage: [{ code: 'free', stores, monthlyPrice: 0, monthlyRevenue: 0 }] });
});

router.get('/packages', async (req, res) => res.json(await PlatformPackage.find().sort({ monthlyPrice: 1 }).lean()));

router.put('/packages/:code', requirePlatformPermission('packages.manage'), async (req, res) => {
    const code = String(req.params.code).toLowerCase();
    if (!['basic', 'starter', 'pro', 'business'].includes(code)) return res.status(400).json({ error: 'Invalid package code' });
    const monthlyPrice = Number(req.body.monthlyPrice);
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) return res.status(400).json({ error: 'Invalid monthly price' });
    const packageItem = await PlatformPackage.findOneAndUpdate(
        { code },
        { $set: { code, name: String(req.body.name || code).trim(), monthlyPrice, currency: 'THB', features: Array.isArray(req.body.features) ? req.body.features.map(String).slice(0, 50) : [], notificationQuota: req.body.notificationQuota ?? null, isActive: req.body.isActive !== false } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await audit(req, 'package.update', { reason: req.body.reason || `Package ${code} updated`, metadata: { code, monthlyPrice } });
    res.json(packageItem);
});

router.get('/audit', requirePlatformPermission('audit.view'), async (req, res) => {
    const filter = req.query.storeId ? { storeId: String(req.query.storeId) } : {};
    res.json(await PlatformAudit.find(filter).populate('actorUserId', 'email name role').sort({ createdAt: -1 }).limit(500).lean());
});

module.exports = router;
