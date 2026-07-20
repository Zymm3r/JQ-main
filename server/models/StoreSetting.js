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
    queueOpen: { type: Boolean, default: true },
    businessHours: { type: [businessHoursSchema], default: [] }
}, { timestamps: true });

storeSettingSchema.index({ storeId: 1, branchId: 1 }, { unique: true });

module.exports = mongoose.model('StoreSetting', storeSettingSchema);
