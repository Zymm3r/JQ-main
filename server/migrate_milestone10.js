const mongoose = require('mongoose');
require('./loadEnv');

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const settings = db.collection('storesettings');
    const queues = db.collection('queues');
    const notifications = db.collection('notificationlogs');

    let settingFieldsBackfilled = 0;
    for (const [field, value] of [
        ['autoCallIntervalMinutes', 5],
        ['autoCallScheduleEnabled', false],
        ['autoCallScheduleStart', '10:00'],
        ['autoCallScheduleEnd', '22:00'],
        ['nextAutoCallAt', null],
        ['lastAutoCallAt', null],
        ['autoCompleteEnabled', false]
    ]) {
        const result = await settings.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
        settingFieldsBackfilled += result.modifiedCount;
    }

    let callCursorsBackfilled = 0;
    for await (const setting of settings.find({ autoCallEnabled: true })) {
        const branchId = setting.branchId || 'default';
        const latest = await queues.find({
            storeId: setting.storeId,
            branchId,
            status: 'waiting',
            scheduledCallAt: { $type: 'date' }
        }).sort({ scheduledCallAt: -1 }).limit(1).next();
        if (latest?.scheduledCallAt) {
            const result = await settings.updateOne(
                { _id: setting._id, nextAutoCallAt: null },
                { $set: { nextAutoCallAt: latest.scheduledCallAt } }
            );
            callCursorsBackfilled += result.modifiedCount;
        }
    }

    await queues.createIndex({ storeId: 1, branchId: 1, status: 1, diningDeadlineAt: 1 });
    await notifications.createIndex(
        { storeId: 1, eventKey: 1 },
        { unique: true, partialFilterExpression: { eventKey: { $type: 'string' } } }
    );

    const summary = {
        settingFieldsBackfilled,
        callCursorsBackfilled,
        notificationEventIndexReady: true,
        destructiveOperations: 0
    };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 10 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
