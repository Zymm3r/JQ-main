async function refreshSubscriptionState(store) {
    if (!store) return null;
    const now = new Date();
    const trialExpired = store.subscriptionStatus === 'trial' && store.trialEndsAt && store.trialEndsAt <= now;
    const paidExpired = store.subscriptionStatus === 'active' && store.subscriptionEndsAt && store.subscriptionEndsAt <= now;
    if (trialExpired || paidExpired) {
        store.subscriptionStatus = 'expired';
        store.isActive = false;
        await store.save();
    } else if (['past_due', 'cancelled', 'expired'].includes(store.subscriptionStatus) && store.isActive) {
        store.isActive = false;
        await store.save();
    }
    return store;
}

function subscriptionAllowsQueue(store, now = new Date()) {
    if (!store || !['trial', 'active'].includes(store.subscriptionStatus)) return false;
    if (store.subscriptionStatus === 'trial' && store.trialEndsAt && store.trialEndsAt <= now) return false;
    if (store.subscriptionStatus === 'active' && store.subscriptionEndsAt && store.subscriptionEndsAt <= now) return false;
    return true;
}

module.exports = { refreshSubscriptionState, subscriptionAllowsQueue };
