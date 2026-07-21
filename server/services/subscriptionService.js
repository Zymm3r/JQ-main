async function refreshSubscriptionState(store) {
    if (!store) return null;
    return store;
}

function subscriptionAllowsQueue(store) {
    return Boolean(store);
}

module.exports = { refreshSubscriptionState, subscriptionAllowsQueue };
