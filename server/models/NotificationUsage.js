const mongoose = require('mongoose');

const notificationUsageSchema = new mongoose.Schema({
    storeId: { type: String, required: true },
    period: { type: String, required: true },
    count: { type: Number, min: 0, default: 0 },
    limit: { type: Number, min: 0, default: null },
    unlimited: { type: Boolean, default: true },
    plan: { type: String, required: true }
}, { timestamps: true });

notificationUsageSchema.index({ storeId: 1, period: 1 }, { unique: true });
notificationUsageSchema.index({ period: 1, count: -1 });

module.exports = mongoose.model('NotificationUsage', notificationUsageSchema);
