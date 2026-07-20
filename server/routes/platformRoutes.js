const express = require('express');
const Store = require('../models/Store');
const StoreReview = require('../models/StoreReview');
const { requireAccount, requirePlatformAdmin } = require('../services/accountAuth');
const { ensureStoreQueueSettings } = require('../services/storeProvisioning');
const { refreshSubscriptionState, subscriptionAllowsQueue } = require('../services/subscriptionService');

const router = express.Router();
router.use(requireAccount, requirePlatformAdmin);

router.get('/stores', async (req, res) => {
    const allowedStatuses = ['draft', 'pending_verification', 'verified', 'rejected', 'suspended'];
    const status = allowedStatuses.includes(req.query.status) ? req.query.status : 'pending_verification';
    const stores = await Store.find({ verificationStatus: status })
        .populate('ownerId', 'email name phone status emailVerified')
        .sort({ submittedAt: 1, createdAt: 1 })
        .limit(100)
        .lean();
    res.json(stores);
});

router.post('/stores/:storeId/decision', async (req, res) => {
    const action = String(req.body.action || '');
    const message = String(req.body.message || '').trim().slice(0, 2000) || null;
    if (!['approve', 'reject', 'request_more_info', 'suspend'].includes(action)) {
        return res.status(400).json({ error: 'Invalid review action' });
    }
    if (['reject', 'request_more_info', 'suspend'].includes(action) && !message) {
        return res.status(400).json({ error: 'A reason or request message is required' });
    }

    const store = await Store.findOne({ storeId: req.params.storeId });
    if (!store) return res.status(404).json({ error: 'Store not found' });
    const now = new Date();

    if (action === 'approve') {
        if (store.verificationStatus !== 'pending_verification') return res.status(409).json({ error: 'Store is not pending verification' });
        store.verificationStatus = 'verified';
        store.isActive = ['trial', 'active'].includes(store.subscriptionStatus) && (!store.trialEndsAt || store.trialEndsAt > now);
        store.rejectionReason = null;
        store.informationRequest = null;
        await ensureStoreQueueSettings(store);
    } else if (action === 'reject') {
        store.verificationStatus = 'rejected';
        store.isActive = false;
        store.rejectionReason = message;
        store.informationRequest = null;
    } else if (action === 'request_more_info') {
        store.verificationStatus = 'draft';
        store.isActive = false;
        store.informationRequest = message;
        store.rejectionReason = null;
    } else {
        store.verificationStatus = 'suspended';
        store.isActive = false;
        store.informationRequest = message;
    }

    store.reviewedAt = now;
    store.reviewedBy = req.account._id;
    await store.save();
    await StoreReview.create({ storeId: store.storeId, reviewerId: req.account._id, action, message });
    res.json({ success: true, store });
});

router.put('/stores/:storeId/subscription', async (req, res) => {
    const statuses = ['trial', 'active', 'past_due', 'cancelled', 'expired'];
    const plans = ['basic', 'pro', 'business'];
    if (!statuses.includes(req.body.status) || !plans.includes(req.body.plan)) {
        return res.status(400).json({ error: 'Invalid subscription status or plan' });
    }
    const store = await Store.findOne({ storeId: req.params.storeId });
    if (!store) return res.status(404).json({ error: 'Store not found' });

    store.subscriptionStatus = req.body.status;
    store.plan = req.body.plan;
    store.subscriptionEndsAt = req.body.subscriptionEndsAt ? new Date(req.body.subscriptionEndsAt) : null;
    if (store.subscriptionEndsAt && Number.isNaN(store.subscriptionEndsAt.getTime())) {
        return res.status(400).json({ error: 'Invalid subscription end date' });
    }
    await refreshSubscriptionState(store);
    store.isActive = store.verificationStatus === 'verified' && subscriptionAllowsQueue(store);
    await store.save();
    res.json({ success: true, store });
});

module.exports = router;
