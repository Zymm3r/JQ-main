const express = require('express');
const mongoose = require('mongoose');
const QrSource = require('../models/QrSource');
const { requireAccount, requireVerifiedAccount } = require('../services/accountAuth');
const { ensureLiffSlug, normalizeSource, buildLiffLinks } = require('../services/liffService');
const { requirePermission } = require('../services/memberPermissions');

const router = express.Router();

router.use((req, res, next) => req.path === '/' ? next('router') : next());
router.use(requireAccount, requireVerifiedAccount);
router.use((req, res, next) => {
    if (!req.auth.storeId || !req.accountStore) return res.status(403).json({ error: 'Merchant store required' });
    next();
});

function sourceResponse(store, source) {
    return {
        id: source._id,
        key: source.key,
        name: source.name,
        kind: source.kind,
        branchName: source.branchName,
        active: source.active,
        scanCount: source.scanCount,
        reservationCount: source.reservationCount,
        ...buildLiffLinks(store, source.key)
    };
}

router.get('/qr', async (req, res) => {
    const store = req.accountStore;
    if (ensureLiffSlug(store) && store.isModified('liffSlug')) await store.save();

    let sources = await QrSource.find({ storeId: req.auth.storeId }).sort({ kind: 1, createdAt: 1 });
    if (!sources.some(source => source.key === 'main')) {
        sources = [
            await QrSource.create({ storeId: req.auth.storeId, key: 'main', name: 'Main store QR', kind: 'main' }),
            ...sources
        ];
    }

    res.json({
        store: { storeId: store.storeId, name: store.name, slug: store.slug, liffSlug: store.liffSlug, logoUrl: store.logoUrl },
        sources: sources.map(source => sourceResponse(store, source))
    });
});

router.post('/qr-sources', requirePermission('settings.update'), async (req, res) => {
    try {
        const key = normalizeSource(req.body.key);
        const name = String(req.body.name || '').trim();
        const kind = String(req.body.kind || 'point');
        const branchName = String(req.body.branchName || '').trim() || null;

        if (key === 'main') return res.status(409).json({ error: 'The main QR source already exists' });
        if (!name || name.length > 120) return res.status(400).json({ error: 'Source name is required' });
        if (!['branch', 'point', 'event'].includes(kind)) return res.status(400).json({ error: 'Invalid source kind' });

        const source = await QrSource.create({ storeId: req.auth.storeId, key, name, kind, branchName });
        res.status(201).json(sourceResponse(req.accountStore, source));
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ error: 'QR source key is already in use' });
        if (error.message === 'INVALID_QR_SOURCE') return res.status(400).json({ error: 'Source key must use lowercase letters, numbers, and hyphens' });
        res.status(500).json({ error: 'Unable to create QR source' });
    }
});

router.delete('/qr-sources/:id', requirePermission('settings.update'), async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid QR source ID' });

    const source = await QrSource.findOne({ _id: req.params.id, storeId: req.auth.storeId });
    if (!source) return res.status(404).json({ error: 'QR source not found' });
    if (source.kind === 'main') return res.status(409).json({ error: 'The main QR source cannot be deleted' });

    await source.deleteOne();
    res.json({ success: true });
});

module.exports = router;
