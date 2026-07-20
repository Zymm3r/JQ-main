import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import liff from '@line/liff';
import toast from 'react-hot-toast';
import { api } from '../api';

export default function LiffQueue() {
    const { liffSlug: routeSlug } = useParams();
    const [params] = useSearchParams();
    const liffSlug = routeSlug || params.get('store');
    const source = params.get('source') || 'main';
    const [store, setStore] = useState(null);
    const [profile, setProfile] = useState(null);
    const [lineReady, setLineReady] = useState(false);
    const [form, setForm] = useState({ customerName: '', pax: 1, phoneNumber: '' });
    const [queue, setQueue] = useState(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!liffSlug) return;
        api.get(`/public/stores/${encodeURIComponent(liffSlug)}/info`, { params: { source } }).then(async ({ data }) => {
            setStore(data);
            if (!data.liffId) { setLineReady(true); return; }
            await liff.init({ liffId: data.liffId });
            if (liff.isLoggedIn()) {
                const value = await liff.getProfile();
                setProfile(value);
                setForm(current => ({ ...current, customerName: current.customerName || value.displayName || '' }));
            }
            setLineReady(true);
        }).catch(error => toast.error(error.response?.data?.error || 'ไม่พบร้านค้า'));
    }, [liffSlug, source]);

    const login = () => liff.login({ redirectUri: window.location.href });
    const submit = async event => {
        event.preventDefault(); setSubmitting(true);
        try {
            const accessToken = store.liffId ? liff.getAccessToken() : null;
            const { data } = await api.post(`/public/stores/${encodeURIComponent(liffSlug)}/reserve`, { ...form, source }, {
                headers: accessToken ? { 'x-line-access-token': accessToken } : {}
            });
            setQueue(data);
        } catch (error) { toast.error(error.response?.data?.error || 'จองคิวไม่สำเร็จ'); }
        finally { setSubmitting(false); }
    };

    if (!store || !lineReady) return <LiffShell><p>กำลังเปิดร้าน...</p></LiffShell>;
    if (queue) return <LiffShell store={store}><div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: '#16a34a' }}>จองคิวสำเร็จ</div>
        <div style={{ fontSize: 72, fontWeight: 800, color: '#2563eb', margin: 12 }}>Q{queue.queueNumber}</div>
        <p>เวลารอโดยประมาณ {queue.estimatedWaitTime} นาที</p>
        <Link className="btn btn-primary" to={`/liff/${liffSlug}/status/${queue.publicToken}`}>ติดตามสถานะคิว</Link>
        <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => navigator.clipboard.writeText(queue.trackingUrl)}>คัดลอกลิงก์ติดตาม</button>
    </div></LiffShell>;
    if (store.liffId && !profile) return <LiffShell store={store}><div style={{ textAlign: 'center' }}>
        <p>เข้าสู่ระบบ LINE เพื่อจองคิวโดยไม่ต้องสมัครบัญชีใหม่</p>
        <button className="btn btn-success" onClick={login}>เข้าสู่ระบบด้วย LINE</button>
    </div></LiffShell>;
    return <LiffShell store={store}><form onSubmit={submit}>
        <p style={{ color: '#64748b' }}>จุดสแกน: {store.sourceName}</p>
        <div className="input-group"><label>ชื่อ</label><input required maxLength="120" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} /></div>
        <div className="input-group"><label>จำนวนคน</label><input required type="number" min="1" max="100" value={form.pax} onChange={e => setForm({ ...form, pax: Number(e.target.value) })} /></div>
        <div className="input-group"><label>เบอร์โทร</label><input type="tel" maxLength="30" value={form.phoneNumber} onChange={e => setForm({ ...form, phoneNumber: e.target.value })} /></div>
        <button className="btn btn-primary" disabled={submitting || !store.queueOpen} style={{ width: '100%' }}>{store.queueOpen ? (submitting ? 'กำลังจอง...' : 'ยืนยันจองคิว') : 'ร้านปิดรับคิว'}</button>
    </form></LiffShell>;
}

function LiffShell({ store, children }) {
    return <main style={{ minHeight: '100vh', background: 'linear-gradient(160deg,#eff6ff,#f8fafc)', padding: 20 }}><div className="card" style={{ maxWidth: 460, margin: '20px auto', textAlign: 'left' }}>
        {store && <header style={{ textAlign: 'center', marginBottom: 22 }}>{store.logoUrl && <img src={store.logoUrl} alt="โลโก้ร้าน" style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 20 }} />}<h1>{store.name}</h1>{store.description && <p style={{ color: '#64748b' }}>{store.description}</p>}</header>}
        {children}
    </div></main>;
}
