const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
    storeId: { type: String, required: true, unique: true, trim: true, lowercase: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null, unique: true, sparse: true },
    name: { type: String, default: null, trim: true },
    slug: { type: String, default: null, trim: true, lowercase: true, unique: true, sparse: true },
    phone: { type: String, default: null, trim: true },
    address: { type: String, default: null, trim: true },
    logoUrl: { type: String, default: null, trim: true },
    description: { type: String, default: null, trim: true },
    verificationStatus: {
        type: String,
        enum: ['draft', 'pending_verification', 'verified', 'rejected', 'suspended'],
        default: 'draft',
        required: true
    },
    subscriptionStatus: {
        type: String,
        enum: ['trial', 'active', 'past_due', 'cancelled', 'expired'],
        default: 'expired',
        required: true
    },
    plan: { type: String, enum: ['basic', 'pro', 'business'], default: 'basic', required: true },
    isActive: { type: Boolean, default: false, required: true },
    location: {
        latitude: { type: Number, default: null },
        longitude: { type: Number, default: null },
        googleMapsUrl: { type: String, default: null, trim: true }
    },
    storefrontPhotoUrl: { type: String, default: null, trim: true },
    onlineChannelUrl: { type: String, default: null, trim: true },
    proofUrls: [{ type: String, trim: true }],
    termsAcceptedAt: { type: Date, default: null },
    submittedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', default: null },
    rejectionReason: { type: String, default: null, trim: true },
    informationRequest: { type: String, default: null, trim: true },
    trialStartedAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    subscriptionEndsAt: { type: Date, default: null }
}, {
    timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }
});

storeSchema.index({ verificationStatus: 1, createdAt: 1 });
storeSchema.index({ subscriptionStatus: 1, trialEndsAt: 1 });

module.exports = mongoose.model('Store', storeSchema);
