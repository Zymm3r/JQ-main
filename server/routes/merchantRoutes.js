const express = require('express');
const Store = require('../models/Store');
const { requireAccount, requireVerifiedAccount } = require('../services/accountAuth');
const { refreshSubscriptionState } = require('../services/subscriptionService');
const { ensureLiffSlug } = require('../services/liffService');
const { requirePermission } = require('../services/memberPermissions');

const router = express.Router();
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function cleanUrl(value) {
    if (!value) return null;
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('INVALID_URL');
    return url.toString();
}

function cleanOptionalNumber(value, min, max) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error('INVALID_LOCATION');
    return number;
}

function storeResponse(store) {
    return {
        storeId: store.storeId,
        ownerId: store.ownerId,
        name: store.name,
        slug: store.slug,
        liffSlug: store.liffSlug,
        phone: store.phone,
        address: store.address,
        logoUrl: store.logoUrl,
        description: store.description,
        verificationStatus: store.verificationStatus,
        subscriptionStatus: store.subscriptionStatus,
        plan: store.plan,
        isActive: store.isActive,
        location: store.location,
        storefrontPhotoUrl: store.storefrontPhotoUrl,
        onlineChannelUrl: store.onlineChannelUrl,
        proofUrls: store.proofUrls,
        termsAccepted: Boolean(store.termsAcceptedAt),
        submittedAt: store.submittedAt,
        rejectionReason: store.rejectionReason,
        informationRequest: store.informationRequest,
        trialEndsAt: store.trialEndsAt,
        createdAt: store.createdAt
    };
}

router.use(requireAccount);

router.get('/store', async (req, res) => {
    if (!req.accountStore) return res.status(404).json({ error: 'Store not found' });
    res.json(storeResponse(await refreshSubscriptionState(req.accountStore)));
});

router.put('/store', requireVerifiedAccount, requirePermission('settings.update'), async (req, res) => {
    const store = req.accountStore;
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (['pending_verification', 'suspended'].includes(store.verificationStatus)) {
        return res.status(409).json({ error: 'Store information is locked during review or suspension' });
    }

    try {
        const name = String(req.body.name || '').trim();
        const slug = String(req.body.slug || '').trim().toLowerCase();
        const phone = String(req.body.phone || '').trim();
        const address = String(req.body.address || '').trim();
        if (!name || name.length > 160) return res.status(400).json({ error: 'Store name is required' });
        if (!SLUG_PATTERN.test(slug) || slug.length > 80) return res.status(400).json({ error: 'Slug must contain lowercase letters, numbers, and hyphens' });
        if (!phone || phone.length > 30) return res.status(400).json({ error: 'Store phone is required' });
        if (!address || address.length > 500) return res.status(400).json({ error: 'Store address is required' });

        const duplicateSlug = await Store.exists({ slug, _id: { $ne: store._id } });
        if (duplicateSlug) return res.status(409).json({ error: 'Store slug is already in use' });

        const proofUrls = Array.isArray(req.body.proofUrls) ? req.body.proofUrls.slice(0, 5).map(cleanUrl) : [];
        store.name = name;
        store.slug = slug;
        ensureLiffSlug(store);
        store.phone = phone;
        store.address = address;
        store.logoUrl = cleanUrl(req.body.logoUrl);
        store.description = String(req.body.description || '').trim().slice(0, 2000) || null;
        store.storefrontPhotoUrl = cleanUrl(req.body.storefrontPhotoUrl);
        store.onlineChannelUrl = cleanUrl(req.body.onlineChannelUrl);
        store.proofUrls = proofUrls;
        store.location = {
            latitude: cleanOptionalNumber(req.body.latitude, -90, 90),
            longitude: cleanOptionalNumber(req.body.longitude, -180, 180),
            googleMapsUrl: cleanUrl(req.body.googleMapsUrl)
        };
        if (req.body.acceptedTerms === true) store.termsAcceptedAt = store.termsAcceptedAt || new Date();
        if (store.verificationStatus === 'rejected') store.verificationStatus = 'draft';
        store.rejectionReason = null;
        store.informationRequest = null;
        await store.save();
        res.json(storeResponse(store));
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'Store slug is already in use' });
        if (['INVALID_URL', 'INVALID_LOCATION'].includes(error.message)) return res.status(400).json({ error: 'Invalid URL or location value' });
        console.error('Store setup failed:', error);
        res.status(500).json({ error: 'Unable to save store information' });
    }
});

router.post('/store/submit', requireVerifiedAccount, requirePermission('settings.update'), async (req, res) => {
    const store = req.accountStore;
    if (!store) return res.status(404).json({ error: 'Store not found' });
    if (store.verificationStatus === 'pending_verification') return res.status(409).json({ error: 'Store is already under review' });

    const hasLocation = Boolean(store.location?.googleMapsUrl) ||
        (Number.isFinite(store.location?.latitude) && Number.isFinite(store.location?.longitude));
    const missing = [];
    if (!store.name) missing.push('name');
    if (!store.slug) missing.push('slug');
    if (!store.phone) missing.push('phone');
    if (!store.address) missing.push('address');
    if (!hasLocation) missing.push('location');
    if (!store.storefrontPhotoUrl) missing.push('storefrontPhotoUrl');
    if (!store.onlineChannelUrl) missing.push('onlineChannelUrl');
    if (!store.termsAcceptedAt) missing.push('termsAccepted');
    if (missing.length) return res.status(400).json({ error: 'Store setup is incomplete', missing });

    const now = new Date();
    store.verificationStatus = 'pending_verification';
    store.subscriptionStatus = 'active';
    store.plan = store.plan || 'basic';
    store.isActive = false;
    store.submittedAt = now;
    store.trialStartedAt = null;
    store.trialEndsAt = null;
    store.subscriptionEndsAt = null;
    store.rejectionReason = null;
    store.informationRequest = null;
    await store.save();
    res.json(storeResponse(store));
});

module.exports = router;
