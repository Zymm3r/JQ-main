const mongoose = require('mongoose');
require('./loadEnv');

async function migrate(mongoUri = process.env.MONGO_URI) {
    if (!mongoUri) throw new Error('MONGO_URI is required');
    await mongoose.connect(mongoUri, { autoIndex: false });
    const db = mongoose.connection.db;
    const settings = db.collection('storesettings');
    const queues = db.collection('queues');

    let settingsBackfilled = 0;
    for (const [field, value] of [
        ['autoCallDelayMinutes', 15],
        ['seatGracePeriodMinutes', 10],
        ['diningTimeLimitMinutes', 90],
        ['autoCancelNoShowEnabled', false]
    ]) {
        const result = await settings.updateMany({ [field]: { $exists: false } }, { $set: { [field]: value } });
        settingsBackfilled += result.modifiedCount;
    }

    let queuesScheduled = 0;
    let arrivalDeadlinesBackfilled = 0;
    let diningDeadlinesBackfilled = 0;
    for await (const setting of settings.find({ autoCallEnabled: true })) {
        const result = await queues.updateMany(
            {
                storeId: setting.storeId,
                branchId: setting.branchId || 'default',
                status: 'waiting',
                scheduledCallAt: null
            },
            [{ $set: { scheduledCallAt: { $add: ['$createdAt', (setting.autoCallDelayMinutes || 15) * 60_000] } } }]
        );
        queuesScheduled += result.modifiedCount;
    }
    for await (const setting of settings.find({})) {
        const scope = { storeId: setting.storeId, branchId: setting.branchId || 'default' };
        const arrivalResult = await queues.updateMany(
            { ...scope, status: 'called', seatDeadlineAt: null },
            [{ $set: { seatDeadlineAt: { $add: [{ $ifNull: ['$calledAt', '$updatedAt', '$createdAt'] }, (setting.seatGracePeriodMinutes || 10) * 60_000] } } }]
        );
        const diningResult = await queues.updateMany(
            { ...scope, status: 'dining', diningDeadlineAt: null },
            [{ $set: { diningDeadlineAt: { $add: [{ $ifNull: ['$seatedAt', '$updatedAt', '$createdAt'] }, (setting.diningTimeLimitMinutes || 90) * 60_000] } } }]
        );
        arrivalDeadlinesBackfilled += arrivalResult.modifiedCount;
        diningDeadlinesBackfilled += diningResult.modifiedCount;
    }

    await queues.createIndex({ storeId: 1, branchId: 1, status: 1, scheduledCallAt: 1, queueNumber: 1 });
    await queues.createIndex({ storeId: 1, branchId: 1, status: 1, seatDeadlineAt: 1 });

    const summary = {
        settingFieldsBackfilled: settingsBackfilled,
        queuesScheduled,
        arrivalDeadlinesBackfilled,
        diningDeadlinesBackfilled,
        destructiveOperations: 0
    };
    await mongoose.disconnect();
    return summary;
}

if (require.main === module) {
    migrate().then(summary => console.log(JSON.stringify(summary, null, 2))).catch(async error => {
        console.error('Milestone 9 migration failed:', error);
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
}

module.exports = { migrate };
