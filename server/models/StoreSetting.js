const mongoose = require('mongoose');

const businessHoursSchema = new mongoose.Schema({
    day: { type: Number, min: 0, max: 6, required: true },
    open: { type: String, default: null },
    close: { type: String, default: null },
    closed: { type: Boolean, default: false }
}, { _id: false });

const storeSettingSchema = new mongoose.Schema({
    storeId: { type: String, required: true, trim: true, lowercase: true },
    branchId: { type: String, required: true, default: 'default' },
    averageTableTime: { type: Number, min: 1, default: 30 },
    averageWaitTime: { type: Number, min: 0, default: 15 },
    totalTables: { type: Number, min: 1, default: 10 },
    maxQueueSize: { type: Number, min: 1, default: 100 },
    autoCallEnabled: { type: Boolean, default: false },
    autoCallDelayMinutes: { type: Number, min: 1, max: 1440, default: 15 },
    autoCallIntervalMinutes: { type: Number, min: 1, max: 1440, default: 5 },
    autoCallScheduleEnabled: { type: Boolean, default: false },
    autoCallScheduleStart: { type: String, default: '10:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    autoCallScheduleEnd: { type: String, default: '22:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    nextAutoCallAt: { type: Date, default: null },
    lastAutoCallAt: { type: Date, default: null },
    seatGracePeriodMinutes: { type: Number, min: 1, max: 1440, default: 10 },
    diningTimeLimitMinutes: { type: Number, min: 1, max: 1440, default: 90 },
    autoCancelNoShowEnabled: { type: Boolean, default: false },
    autoCompleteEnabled: { type: Boolean, default: false },
    queueOpen: { type: Boolean, default: true },
    businessHours: { type: [businessHoursSchema], default: [] }
}, { timestamps: true });

storeSettingSchema.index({ storeId: 1, branchId: 1 }, { unique: true });

module.exports = mongoose.model('StoreSetting', storeSettingSchema);
