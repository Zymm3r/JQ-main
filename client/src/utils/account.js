export function saveAccountSession(response) {
    localStorage.setItem('account_token', response.token);
    localStorage.setItem('account_user', JSON.stringify(response.user));
    if (response.store) localStorage.setItem('account_store', JSON.stringify(response.store));
    if (response.devVerificationCode) localStorage.setItem('dev_verification_code', response.devVerificationCode);
}

export function clearAccountSession() {
    localStorage.removeItem('account_token');
    localStorage.removeItem('account_user');
    localStorage.removeItem('account_store');
    localStorage.removeItem('dev_verification_code');
}

export function getAccountToken() {
    return localStorage.getItem('account_token');
}
