const mongoose = require('mongoose');

const queueSessionSchema = new mongoose.Schema({
    storeId: { type: String, required: true, trim: true, lowercase: true },
    branchId: { type: String, required: true, default: 'default' },
    sessionId: { type: String, required: true },
    status: { type: String, enum: ['active', 'ended'], default: 'active', required: true },
    startedAt: { type: Date, default: Date.now, required: true },
    endedAt: { type: Date, default: null },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null }
}, { timestamps: true });

queueSessionSchema.index({ storeId: 1, branchId: 1, sessionId: 1 }, { unique: true });
queueSessionSchema.index(
    { storeId: 1, branchId: 1, status: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('QueueSession', queueSessionSchema);
