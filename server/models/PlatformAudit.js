const mongoose = require('mongoose');

const platformAuditSchema = new mongoose.Schema({
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', required: true },
    actorRole: { type: String, required: true },
    action: { type: String, required: true, trim: true },
    storeId: { type: String, default: null, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null }
}, { timestamps: true });

platformAuditSchema.index({ actorUserId: 1, createdAt: -1 });
platformAuditSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('PlatformAudit', platformAuditSchema);
