const mongoose = require('mongoose');

const platformPackageSchema = new mongoose.Schema({
    code: { type: String, enum: ['basic', 'starter', 'pro', 'business'], required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    monthlyPrice: { type: Number, min: 0, required: true },
    currency: { type: String, default: 'THB', uppercase: true, trim: true },
    features: [{ type: String, trim: true }],
    notificationQuota: { type: Number, min: 0, default: null },
    isActive: { type: Boolean, default: true, required: true }
}, { timestamps: true });

module.exports = mongoose.model('PlatformPackage', platformPackageSchema);
