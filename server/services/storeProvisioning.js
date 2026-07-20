const Setting = require('../models/Setting');
const Counter = require('../models/Counter');

async function ensureStoreQueueSettings(store) {
    const sessionId = `session_${Date.now()}`;
    const defaults = [
        ['store_name', store.name],
        ['table_count', '10'],
        ['avg_time', '30'],
        ['avg_wait_time', '15'],
        ['active_session', sessionId]
    ];

    for (const [key, value] of defaults) {
        await Setting.findOneAndUpdate(
            { storeId: store.storeId, key },
            { $setOnInsert: { storeId: store.storeId, key, value: String(value) } },
            { upsert: true, new: true, runValidators: true }
        );
    }
    const activeSession = await Setting.findOne({ storeId: store.storeId, key: 'active_session' }).lean();
    await Counter.findOneAndUpdate(
        { storeId: store.storeId, sessionId: activeSession.value },
        { $setOnInsert: { seq: 0 } },
        { upsert: true, new: true }
    );
}

module.exports = { ensureStoreQueueSettings };
