const mongoose = require('mongoose');

const ROLES = ['owner', 'manager', 'staff', 'viewer'];
const PERMISSIONS = [
    'queue.call', 'queue.seat', 'queue.complete', 'queue.cancel',
    'session.reset', 'settings.update', 'members.manage', 'billing.manage'
];

const storeMemberSchema = new mongoose.Schema({
    storeId: { type: String, required: true, trim: true, lowercase: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformUser', required: true },
    role: { type: String, enum: ROLES, default: 'staff', required: true },
    permissions: [{ type: String, enum: PERMISSIONS }],
    status: { type: String, enum: ['invited', 'active', 'suspended'], default: 'active', required: true }
}, { timestamps: true });

storeMemberSchema.index({ storeId: 1, userId: 1 }, { unique: true });
storeMemberSchema.index({ userId: 1, status: 1 });
storeMemberSchema.index({ storeId: 1, role: 1, status: 1 });

storeMemberSchema.pre('validate', async function preventPlatformMembership() {
    if (!this.userId) return;
    const user = await mongoose.model('PlatformUser').findById(this.userId).select('role').lean();
    if (user && ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'platform_admin'].includes(user.role)) {
        this.invalidate('userId', 'Platform accounts cannot be store members');
    }
});

module.exports = mongoose.model('StoreMember', storeMemberSchema);
module.exports.ROLES = ROLES;
module.exports.PERMISSIONS = PERMISSIONS;
