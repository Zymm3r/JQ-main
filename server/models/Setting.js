// models/Setting.js
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema({
    storeId: {
        type: String,
        required: true,
        default: 'legacy-store',
        trim: true
    },
    key: {
        type: String,
        required: [true, 'Setting key is required'],
        trim: true
    },
    value: {
        type: String,
        required: [true, 'Setting value is required'],
        trim: true
    }
}, { timestamps: true });

// Explicitly define unique index
settingSchema.index({ storeId: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('Setting', settingSchema);
