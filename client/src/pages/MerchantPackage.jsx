import { useEffect, useState } from 'react';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

export default function MerchantPackage() {
    const [store, setStore] = useState(null);
    const [usage, setUsage] = useState(null);
    const [logs, setLogs] = useState([]);

    useEffect(() => {
        api.get('/merchant/store').then(({ data }) => setStore(data));
        api.get('/store/notifications/usage').then(({ data }) => setUsage(data));
        api.get('/store/notifications/logs', { params: { limit: 10 } }).then(({ data }) => setLogs(data));
    }, []);

    return <div><MerchantNav /><main style={{ maxWidth: 760, margin: '28px auto', padding: '0 18px' }}>
        <h1>LINE Usage</h1>
        <div className="card" style={{ marginTop: 20 }}>
            {!store ? 'Loading...' : <>
                <h2>Free queue service</h2>
                <p>Queue system: {store.isActive ? 'Active' : 'Inactive'}</p>
                <p style={{ color: 'var(--success)', fontWeight: 700 }}>No subscription gate or monthly LINE quota is enforced.</p>
            </>}
        </div>
        {usage && <div className="card" style={{ marginTop: 16 }}><h2>LINE notifications</h2><p><strong>{usage.count.toLocaleString()}</strong> messages used · {usage.period}</p><p style={{ color: 'var(--success)', fontWeight: 700 }}>Free and unlimited for every store</p></div>}
        <div className="card" style={{ marginTop: 16 }}><h2>Recent notifications</h2>{logs.length ? logs.map(log => <div key={log._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}><span>{log.type}</span><span>{log.status}{log.retryCount ? ` · retry ${log.retryCount}` : ''}{log.errorCode ? ` · ${log.errorCode}` : ''}</span></div>) : <p>No notifications sent this month.</p>}</div>
    </main></div>;
}
