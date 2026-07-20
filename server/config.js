const DEFAULT_STORE_ID = process.env.DEFAULT_STORE_ID || 'legacy-store';

const STORE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function normalizeStoreId(value) {
    const storeId = String(value || DEFAULT_STORE_ID).trim().toLowerCase();
    if (!STORE_ID_PATTERN.test(storeId)) {
        const error = new Error('INVALID_STORE_ID');
        error.statusCode = 400;
        throw error;
    }
    return storeId;
}

module.exports = { DEFAULT_STORE_ID, normalizeStoreId };
