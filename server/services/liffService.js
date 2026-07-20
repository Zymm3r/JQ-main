const crypto = require('crypto');

const SOURCE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function randomSuffix() {
    return crypto.randomBytes(4).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
}

function ensureLiffSlug(store) {
    if (!store.liffSlug && store.slug) store.liffSlug = `${store.slug}-${randomSuffix()}`;
    return store.liffSlug;
}

function normalizeSource(value) {
    const source = String(value || 'main').trim().toLowerCase();
    if (!SOURCE_PATTERN.test(source) || source.length > 64) {
        const error = new Error('INVALID_QR_SOURCE');
        error.statusCode = 400;
        throw error;
    }
    return source;
}

function buildLiffLinks(store, source = 'main') {
    const safeSource = normalizeSource(source);
    const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
    const directUrl = `${appBaseUrl}/liff/${encodeURIComponent(store.liffSlug)}?source=${encodeURIComponent(safeSource)}`;
    const liffId = String(process.env.LINE_LIFF_ID || '').trim();
    const liffUrl = liffId
        ? `https://liff.line.me/${encodeURIComponent(liffId)}?store=${encodeURIComponent(store.liffSlug)}&source=${encodeURIComponent(safeSource)}`
        : directUrl;
    return { source: safeSource, liffId: liffId || null, directUrl, liffUrl };
}

module.exports = { SOURCE_PATTERN, ensureLiffSlug, normalizeSource, buildLiffLinks };
