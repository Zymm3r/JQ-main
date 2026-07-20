const mongoose = require('mongoose');

const storeReviewSchema = new mongoose.Schema({
    storeId: { type: String, required: true, index: true },
    reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', required: true },
    action: { type: String, enum: ['approve', 'reject', 'request_more_info', 'suspend'], required: true },
    message: { type: String, default: null, trim: true }
}, { timestamps: true });

module.exports = mongoose.model('StoreReview', storeReviewSchema);
