const PLATFORM_PERMISSIONS = Object.freeze({
    PLATFORM_ADMIN: Object.freeze(['platform.view', 'stores.review', 'stores.suspend', 'subscriptions.manage', 'quota.manage', 'stores.impersonate', 'revenue.view', 'packages.manage', 'audit.view']),
    PLATFORM_SUPPORT: Object.freeze(['platform.view', 'stores.review', 'stores.suspend', 'stores.impersonate', 'audit.view']),
    platform_admin: Object.freeze(['platform.view', 'stores.review', 'stores.suspend', 'subscriptions.manage', 'quota.manage', 'stores.impersonate', 'revenue.view', 'packages.manage', 'audit.view'])
});

function isPlatformRole(role) { return Object.prototype.hasOwnProperty.call(PLATFORM_PERMISSIONS, role); }
function isStoreRole(role) { return ['STORE_OWNER', 'STORE_STAFF', 'merchant'].includes(role); }
function platformPermissions(role) { return [...(PLATFORM_PERMISSIONS[role] || [])]; }

function requirePlatformPermission(permission) {
    return (req, res, next) => {
        if (!req.auth?.platformPermissions?.includes(permission)) return res.status(403).json({ error: `Platform permission required: ${permission}` });
        next();
    };
}

module.exports = { PLATFORM_PERMISSIONS, isPlatformRole, isStoreRole, platformPermissions, requirePlatformPermission };
