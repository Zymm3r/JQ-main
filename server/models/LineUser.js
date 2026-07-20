const mongoose = require('mongoose');

const lineUserSchema = new mongoose.Schema({
    storeId: { type: String, required: true, default: 'legacy-store' },
    lineUserId: { type: String, required: true },
    line_id: { type: String, default: null, select: false },
    name: { type: String, default: null }
}, { timestamps: true, collection: 'users' });

lineUserSchema.index({ storeId: 1, lineUserId: 1 }, { unique: true });

module.exports = mongoose.model('LineUser', lineUserSchema);
