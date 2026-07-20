// models/Counter.js
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
    storeId: { type: String, required: true },
    branchId: { type: String, required: true, default: 'default' },
    sessionId: { type: String, required: true },
    seq: { type: Number, default: 0 }
});

counterSchema.index({ storeId: 1, branchId: 1, sessionId: 1 }, { unique: true });

module.exports = mongoose.model('Counter', counterSchema);
