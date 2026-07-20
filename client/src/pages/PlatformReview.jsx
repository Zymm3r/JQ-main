import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { clearAccountSession, getAccountToken } from '../utils/account';

export default function PlatformReview() {
    const navigate = useNavigate();
    const [stores, setStores] = useState([]);
    const [status, setStatus] = useState('pending_verification');

    const load = useCallback(() => api.get('/platform/stores', { params: { status } }).then(({ data }) => setStores(data)).catch(error => {
        if (error.response?.status === 401) { clearAccountSession(); navigate('/login'); }
        else toast.error(error.response?.data?.error || 'Unable to load stores');
    }), [navigate, status]);

    useEffect(() => {
        if (!getAccountToken()) { navigate('/login'); return; }
        load();
    }, [load, navigate]);

    const decide = async (storeId, action) => {
        let message = null;
        if (action !== 'approve') {
            message = window.prompt(action === 'request_more_info' ? 'ระบุข้อมูลที่ต้องการเพิ่ม' : 'ระบุเหตุผล');
            if (!message) return;
        }
        try {
            await api.post(`/platform/stores/${storeId}/decision`, { action, message });
            toast.success('Review updated');
            load();
        } catch (error) {
            toast.error(error.response?.data?.error || 'Unable to update review');
        }
    };

    return (
        <div style={{ maxWidth: 1000, margin: '20px auto' }}>
            <div className="card" style={{ textAlign: 'left', marginBottom: 20 }}>
                <h2>Platform Store Verification</h2>
                <select value={status} onChange={event => setStatus(event.target.value)} style={{ ...inputStyle, marginTop: 16, maxWidth: 260 }}>
                    {['pending_verification', 'draft', 'verified', 'rejected', 'suspended'].map(value => <option key={value}>{value}</option>)}
                </select>
            </div>
            {stores.map(store => (
                <div key={store.storeId} className="card" style={{ textAlign: 'left', marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><h3>{store.name || 'Unnamed store'}</h3><code>{store.storeId}</code></div>
                    <p style={{ marginTop: 8 }}>{store.address}</p>
                    <p style={{ color: 'var(--text-light)', marginTop: 6 }}>Owner: {store.ownerId?.name} · {store.ownerId?.email} · {store.ownerId?.phone}</p>
                    {store.storefrontPhotoUrl && <a href={store.storefrontPhotoUrl} target="_blank" rel="noreferrer">ดูรูปหน้าร้าน</a>}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 18 }}>
                        <Action color="var(--success)" onClick={() => decide(store.storeId, 'approve')}>Approve</Action>
                        <Action color="var(--danger)" onClick={() => decide(store.storeId, 'reject')}>Reject</Action>
                        <Action color="var(--warning)" onClick={() => decide(store.storeId, 'request_more_info')}>Request more information</Action>
                        <Action color="#475569" onClick={() => decide(store.storeId, 'suspend')}>Suspend</Action>
                    </div>
                </div>
            ))}
            {!stores.length && <div className="card">No stores in this status.</div>}
        </div>
    );
}

const inputStyle = { width: '100%', padding: 10, border: '2px solid #e2e8f0', borderRadius: 10 };
function Action({ children, color, onClick }) {
    return <button className="btn" style={{ width: 'auto', padding: '8px 14px', background: color, color: 'white' }} onClick={onClick}>{children}</button>;
}
