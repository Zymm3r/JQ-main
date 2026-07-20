const mongoose = require('mongoose');

const TYPES = [
    'QUEUE_RESERVED', 'QUEUE_UPDATED', 'QUEUE_NEAR', 'QUEUE_CALLED',
    'QUEUE_CANCELLED', 'QUEUE_COMPLETED', 'STORE_CLOSED'
];

const notificationLogSchema = new mongoose.Schema({
    storeId: { type: String, required: true, index: true },
    queueId: { type: mongoose.Schema.Types.ObjectId, ref: 'Queue', default: null, index: true },
    lineUserId: { type: String, required: true },
    type: { type: String, enum: TYPES, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed', 'quota_exceeded'], default: 'pending', required: true },
    sentAt: { type: Date, default: null },
    errorCode: { type: String, default: null },
    retryCount: { type: Number, min: 0, default: 0 },
    retryNeeded: { type: Boolean, default: false },
    period: { type: String, required: true },
    messageCost: { type: Number, min: 0, default: 1 }
}, { timestamps: true });

notificationLogSchema.index({ storeId: 1, createdAt: -1 });
notificationLogSchema.index({ storeId: 1, period: 1, status: 1 });
notificationLogSchema.index({ status: 1, retryCount: 1, createdAt: -1 });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
module.exports.TYPES = TYPES;
