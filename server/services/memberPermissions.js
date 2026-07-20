const ROLE_PERMISSIONS = Object.freeze({
    owner: Object.freeze(['queue.call', 'queue.seat', 'queue.complete', 'queue.cancel', 'session.reset', 'settings.update', 'members.manage', 'billing.manage']),
    manager: Object.freeze(['queue.call', 'queue.seat', 'queue.complete', 'queue.cancel', 'session.reset', 'settings.update', 'members.manage']),
    staff: Object.freeze(['queue.call', 'queue.seat', 'queue.complete', 'queue.cancel']),
    viewer: Object.freeze([])
});

function effectivePermissions(member) {
    return [...new Set([...(ROLE_PERMISSIONS[member?.role] || []), ...(member?.permissions || [])])];
}

function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.auth?.permissions?.includes(permission)) {
            return res.status(403).json({ error: `Permission required: ${permission}` });
        }
        next();
    };
}

module.exports = { ROLE_PERMISSIONS, effectivePermissions, requirePermission };
