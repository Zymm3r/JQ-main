import axios from 'axios';
import { io } from 'socket.io-client';

// Auto-detect production mode
const isProd = import.meta.env.PROD;
// In production, use relative path (same origin). In dev, use localhost or env var.
const API_URL = isProd ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');
export const STORE_ID = import.meta.env.VITE_STORE_ID || 'legacy-store';

console.log('Connecting to API:', API_URL);

export const api = axios.create({
    baseURL: `${API_URL}/api`,
    headers: { 'x-store-id': STORE_ID },
});

api.interceptors.request.use(config => {
    const accountRoute = ['/auth/me', '/auth/send-verification', '/auth/verify-email', '/merchant/', '/platform/']
        .some(prefix => String(config.url || '').startsWith(prefix));
    const token = localStorage.getItem(accountRoute ? 'account_token' : 'admin_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

export const socket = io(API_URL, { auth: { storeId: STORE_ID } });
