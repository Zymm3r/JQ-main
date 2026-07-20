const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    storeId: {
        type: String,
        required: true,
        default: 'legacy-store'
    },
    lineUserId: {
        type: String,
        required: true
    },
    // Deprecated compatibility field; retained until a later cleanup migration.
    line_id: { type: String, default: null, select: false },
    name: {
        type: String,
        default: null
    }
}, { timestamps: true });

userSchema.index({ storeId: 1, lineUserId: 1 }, { unique: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
