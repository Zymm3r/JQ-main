const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    role: { type: String, enum: ['merchant', 'platform_admin'], default: 'merchant', required: true },
    status: { type: String, enum: ['pending_verification', 'active', 'suspended'], default: 'pending_verification', required: true },
    emailVerified: { type: Boolean, default: false },
    verificationCodeHash: { type: String, default: null, select: false },
    verificationExpiresAt: { type: Date, default: null, select: false },
    verificationSentAt: { type: Date, default: null, select: false },
    acceptedTermsAt: { type: Date, default: null }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
    collection: 'platform_users'
});

userSchema.index({ role: 1, status: 1 });

module.exports = mongoose.model('PlatformUser', userSchema);
