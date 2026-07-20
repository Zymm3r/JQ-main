const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
    storeId: { type: String, required: true, unique: true, trim: true, lowercase: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' }
}, { timestamps: true });

module.exports = mongoose.model('Store', storeSchema);
