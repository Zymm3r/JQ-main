const mongoose = require('mongoose');

const qrSourceSchema = new mongoose.Schema({
    storeId: { type: String, required: true, trim: true, lowercase: true },
    key: { type: String, required: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: ['main', 'branch', 'point', 'event'], default: 'point', required: true },
    branchName: { type: String, default: null, trim: true },
    active: { type: Boolean, default: true },
    scanCount: { type: Number, min: 0, default: 0 },
    reservationCount: { type: Number, min: 0, default: 0 },
    lastScannedAt: { type: Date, default: null }
}, { timestamps: true });

qrSourceSchema.index({ storeId: 1, key: 1 }, { unique: true });
qrSourceSchema.index({ storeId: 1, active: 1, createdAt: 1 });

module.exports = mongoose.model('QrSource', qrSourceSchema);
