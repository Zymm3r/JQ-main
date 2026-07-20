import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { clearAccountSession, getAccountToken } from '../utils/account';

export default function PlatformReview() {
    const navigate = useNavigate();
    const [overview, setOverview] = useState(null);
    const [stores, setStores] = useState([]);
    const [packages, setPackages] = useState([]);
    const [revenue, setRevenue] = useState(null);
    const [errors, setErrors] = useState([]);
    const [audits, setAudits] = useState([]);
    const [status, setStatus] = useState('');

    const loadStores = () => api.get('/platform/stores', { params: status ? { status } : {} }).then(({ data }) => setStores(data));

    useEffect(() => {
        if (!getAccountToken()) { navigate('/login'); return; }
        const onError = error => {
            if ([401, 403].includes(error.response?.status)) { clearAccountSession(); navigate('/login'); }
            else toast.error(error.response?.data?.error || 'Unable to load platform data');
        };
        api.get('/platform/overview').then(({ data }) => setOverview(data)).catch(onError);
        api.get('/platform/stores').then(({ data }) => setStores(data)).catch(onError);
        api.get('/platform/packages').then(({ data }) => setPackages(data)).catch(() => {});
        api.get('/platform/revenue').then(({ data }) => setRevenue(data)).catch(() => {});
        api.get('/platform/errors').then(({ data }) => setErrors(data)).catch(() => {});
        api.get('/platform/audit').then(({ data }) => setAudits(data)).catch(() => {});
    }, [navigate]);

    const decide = async (storeId, action) => {
        const message = action === 'approve' ? null : window.prompt(action === 'request_more_info' ? 'ระบุข้อมูลที่ต้องการเพิ่ม' : 'ระบุเหตุผล');
        if (action !== 'approve' && !message) return;
        try { await api.post(`/platform/stores/${storeId}/decision`, { action, message }); toast.success('Store review updated'); loadStores(); }
        catch (error) { toast.error(error.response?.data?.error || 'Unable to update review'); }
    };

    const adjustQuota = async store => {
        const entered = window.prompt('จำนวนข้อความต่อเดือน (เว้นว่าง = ไม่จำกัด)', store.notificationQuotaOverride ?? '');
        if (entered === null) return;
        const reason = window.prompt('เหตุผลในการปรับ quota');
        if (!reason) return;
        try { await api.put(`/platform/stores/${store.storeId}/quota`, { limit: entered === '' ? null : Number(entered), reason }); toast.success('Quota updated'); loadStores(); }
        catch (error) { toast.error(error.response?.data?.error || 'Unable to update quota'); }
    };

    const updateSubscription = async store => {
        const plan = window.prompt('Package: basic, starter, pro, business', store.plan);
        if (!plan) return;
        const subscriptionStatus = window.prompt('Status: trial, active, past_due, cancelled, expired', store.subscriptionStatus);
        if (!subscriptionStatus) return;
        try { await api.put(`/platform/stores/${store.storeId}/subscription`, { plan, status: subscriptionStatus, reason: 'Updated from platform admin' }); toast.success('Subscription updated'); loadStores(); }
        catch (error) { toast.error(error.response?.data?.error || 'Unable to update subscription'); }
    };

    const impersonate = async store => {
        const reason = window.prompt('ระบุเหตุผลอย่างน้อย 10 ตัวอักษรสำหรับ audit log');
        if (!reason) return;
        try {
            const { data } = await api.post(`/platform/stores/${store.storeId}/impersonate`, { reason });
            localStorage.setItem('platform_account_token', getAccountToken());
            localStorage.setItem('account_token', data.token);
            localStorage.setItem('account_store', JSON.stringify({ storeId: store.storeId, name: store.name, membership: { role: 'platform_impersonation' } }));
            localStorage.removeItem('active_branch_id');
            navigate('/store/queues');
        } catch (error) { toast.error(error.response?.data?.error || 'Unable to impersonate store'); }
    };

    const editPackage = async item => {
        const monthlyPrice = window.prompt('Monthly price (THB)', item.monthlyPrice);
        if (monthlyPrice === null) return;
        try {
            const { data } = await api.put(`/platform/packages/${item.code}`, { ...item, monthlyPrice: Number(monthlyPrice), reason: 'Package updated from platform admin' });
            setPackages(current => current.map(value => value.code === data.code ? data : value));
            toast.success('Package updated');
        } catch (error) { toast.error(error.response?.data?.error || 'Unable to update package'); }
    };

    return <main style={{ maxWidth: 1200, margin: '22px auto', padding: '0 18px' }}>
        <header className="card" style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 15 }}>
            <div><h1>Platform Admin</h1><p>Control plane แยกจากระบบจัดการร้าน</p></div>
            <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => { clearAccountSession(); navigate('/login'); }}>Logout</button>
        </header>

        {overview && <section className="grid-2" style={{ marginTop: 18 }}>
            <Metric label="Stores" value={overview.stores} /><Metric label="Active subscriptions" value={overview.activeSubscriptions} />
            <Metric label="Queues" value={overview.totalQueues} /><Metric label={`LINE messages · ${overview.period}`} value={overview.lineMessages} />
        </section>}

        <section className="card" style={{ textAlign: 'left', marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}><h2>Stores</h2><select value={status} onChange={event => { setStatus(event.target.value); api.get('/platform/stores', { params: event.target.value ? { status: event.target.value } : {} }).then(({ data }) => setStores(data)); }} style={{ ...inputStyle, maxWidth: 240 }}><option value="">All statuses</option>{['pending_verification', 'draft', 'verified', 'rejected', 'suspended'].map(value => <option key={value}>{value}</option>)}</select></div>
            <div style={{ overflowX: 'auto', marginTop: 14 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><Th>Store</Th><Th>Status</Th><Th>Subscription</Th><Th>Usage</Th><Th>Actions</Th></tr></thead><tbody>{stores.map(store => <tr key={store.storeId}>
                <Td><strong>{store.name || 'Unnamed store'}</strong><br /><small>{store.storeId}<br />{store.ownerId?.email}</small></Td>
                <Td>{store.verificationStatus}</Td><Td>{store.plan} · {store.subscriptionStatus}<br /><small>Quota: {store.notificationQuotaOverride ?? 'Unlimited'}</small></Td>
                <Td>{store.queueCount} queues<br />{store.lineMessageCount} LINE</Td>
                <Td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {store.verificationStatus === 'pending_verification' && <Action onClick={() => decide(store.storeId, 'approve')}>Verify</Action>}
                    <Action onClick={() => decide(store.storeId, 'suspend')}>Suspend</Action><Action onClick={() => updateSubscription(store)}>Subscription</Action><Action onClick={() => adjustQuota(store)}>Quota</Action><Action onClick={() => impersonate(store)}>Impersonate</Action>
                </div></Td>
            </tr>)}</tbody></table></div>
        </section>

        <section className="grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
            <div className="card" style={{ textAlign: 'left' }}><h2>Packages</h2>{packages.map(item => <div key={item.code} style={rowStyle}><span><strong>{item.name}</strong><br />{item.monthlyPrice.toLocaleString()} {item.currency}/month</span><Action onClick={() => editPackage(item)}>Manage</Action></div>)}</div>
            <div className="card" style={{ textAlign: 'left' }}><h2>Revenue report</h2>{revenue ? <><h3 style={{ marginTop: 14 }}>{revenue.monthlyRecurringRevenue.toLocaleString()} {revenue.currency} MRR</h3>{revenue.byPackage.map(item => <div key={item.code} style={rowStyle}><span>{item.code} · {item.stores} stores</span><strong>{item.monthlyRevenue.toLocaleString()} THB</strong></div>)}</> : <p>Revenue access requires Platform Admin.</p>}</div>
            <div className="card" style={{ textAlign: 'left' }}><h2>Error log</h2>{errors.slice(0, 20).map(item => <div key={item._id} style={rowStyle}><span>{item.storeId}<br /><small>{item.type}</small></span><strong>{item.errorCode || item.status}</strong></div>)}{!errors.length && <p>No errors.</p>}</div>
            <div className="card" style={{ textAlign: 'left' }}><h2>Audit log</h2>{audits.slice(0, 20).map(item => <div key={item._id} style={rowStyle}><span>{item.action}<br /><small>{item.actorUserId?.email || item.actorRole} · {item.storeId || 'platform'}</small></span><small>{new Date(item.createdAt).toLocaleString()}</small></div>)}{!audits.length && <p>No audit events.</p>}</div>
        </section>
    </main>;
}

function Metric({ label, value }) { return <div className="card" style={{ textAlign: 'left' }}><small>{label}</small><h2 style={{ marginTop: 5 }}>{Number(value || 0).toLocaleString()}</h2></div>; }
function Action({ children, onClick }) { return <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 9px' }} onClick={onClick}>{children}</button>; }
function Th({ children }) { return <th style={{ textAlign: 'left', padding: 9, borderBottom: '2px solid #e2e8f0' }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: 9, verticalAlign: 'top', borderBottom: '1px solid #e2e8f0' }}>{children}</td>; }
const inputStyle = { width: '100%', padding: 10, border: '2px solid #e2e8f0', borderRadius: 10 };
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #e2e8f0' };
