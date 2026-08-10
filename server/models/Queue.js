const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['reserved', 'called', 'seated', 'completed', 'cancelled'],
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const queueSchema = new mongoose.Schema({
    storeId: {
        type: String,
        required: true,
        index: true
    },
    branchId: { type: String, required: true, default: 'default', index: true },
    sessionId: {
        type: String,
        required: true
    },
    queueNumber: {
        type: Number,
        required: true
    },
    publicToken: {
        type: String,
        required: true,
        default: () => require('crypto').randomBytes(24).toString('base64url')
    },
    source: { type: String, default: 'main', trim: true, lowercase: true },
    idempotencyKey: { type: String, default: null, trim: true, select: false },
    status: {
        type: String,
        enum: ['waiting', 'called', 'dining', 'completed', 'cancelled'],
        default: 'waiting',
        required: true
    },
    customerName: {
        type: String,
        required: true
    },
    lineUserId: {
        type: String,
        default: null
    },
    // Kept temporarily so the non-destructive migration can preserve legacy data.
    line_id: { type: String, default: null, select: false },
    cancelTokenHash: { type: String, default: null, select: false },
    phoneNumber: {
        type: String,
        default: null
    },
    pax: {
        type: Number,
        default: 1
    },
    time_slot: {
        type: String,
        default: null
    },
    seatedAt: {
        type: Date,
        default: null
    },
    completedAt: {
        type: Date,
        default: null
    },
    calledAt: {
        type: Date,
        default: null
    },
    scheduledCallAt: { type: Date, default: null },
    seatDeadlineAt: { type: Date, default: null },
    diningDeadlineAt: { type: Date, default: null },
    cancelledAt: {
        type: Date,
        default: null
    },
    cancellationReason: { type: String, default: null, trim: true, maxlength: 80 },
    manualAction: {
        type: Boolean,
        default: false
    },
    history: [historySchema],
    estimatedWaitTime: { type: Number, min: 0, default: 0 },
    lastNotifiedQueueAhead: { type: Number, min: 0, default: null },
    nearNotificationSentAt: { type: Date, default: null }
}, { timestamps: true });

queueSchema.index({ storeId: 1, branchId: 1, sessionId: 1, status: 1, queueNumber: 1 });
queueSchema.index({ storeId: 1, branchId: 1, sessionId: 1, status: 1, createdAt: 1, manualAction: 1 });
queueSchema.index({ storeId: 1, branchId: 1, status: 1, scheduledCallAt: 1, queueNumber: 1 });
queueSchema.index({ storeId: 1, branchId: 1, status: 1, seatDeadlineAt: 1 });
queueSchema.index({ storeId: 1, branchId: 1, sessionId: 1, queueNumber: 1 }, { unique: true });
queueSchema.index({ storeId: 1, publicToken: 1 }, { unique: true });
queueSchema.index(
    { storeId: 1, branchId: 1, sessionId: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);

const Queue = mongoose.model('Queue', queueSchema);

module.exports = Queue;
