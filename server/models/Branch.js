const crypto = require('crypto');
const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
    storeId: { type: String, required: true, trim: true, lowercase: true },
    branchId: { type: String, required: true, default: () => `branch-${crypto.randomUUID()}` },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    address: { type: String, default: null, trim: true, maxlength: 500 },
    phone: { type: String, default: null, trim: true, maxlength: 30 },
    timezone: { type: String, default: 'Asia/Bangkok', trim: true },
    isActive: { type: Boolean, default: true, required: true },
    isDefault: { type: Boolean, default: false, required: true }
}, { timestamps: true });

branchSchema.index({ storeId: 1, branchId: 1 }, { unique: true });
branchSchema.index({ storeId: 1, slug: 1 }, { unique: true });
branchSchema.index({ storeId: 1, isActive: 1 });
branchSchema.index({ storeId: 1, isDefault: 1 }, { unique: true, partialFilterExpression: { isDefault: true } });

module.exports = mongoose.model('Branch', branchSchema);
