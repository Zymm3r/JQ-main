import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { clearAccountSession, getAccountToken } from '../utils/account';
import MerchantNav from '../components/MerchantNav';

const emptyStore = {
    name: '', slug: '', phone: '', address: '', logoUrl: '', description: '',
    storefrontPhotoUrl: '', onlineChannelUrl: '', googleMapsUrl: '', latitude: '', longitude: '',
    proofUrls: [''], acceptedTerms: false
};

const missingLabels = {
    name: 'ชื่อร้าน',
    slug: 'slug',
    phone: 'เบอร์โทรร้าน',
    address: 'ที่อยู่ร้าน',
    storefrontPhotoUrl: 'รูปหน้าร้าน',
    onlineChannelUrl: 'ช่องทางออนไลน์',
    termsAcceptedAt: 'การยอมรับข้อกำหนด'
};

export default function StoreSetup() {
    const navigate = useNavigate();
    const [form, setForm] = useState(emptyStore);
    const [status, setStatus] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(() => api.get('/merchant/store').then(({ data }) => {
        setStatus(data);
        setForm({
            ...emptyStore,
            ...data,
            latitude: data.location?.latitude ?? '',
            longitude: data.location?.longitude ?? '',
            googleMapsUrl: data.location?.googleMapsUrl || '',
            description: data.description || '',
            proofUrls: data.proofUrls?.length ? data.proofUrls : [''],
            acceptedTerms: data.termsAccepted
        });
    }).catch(error => {
        if (error.response?.status === 401) { clearAccountSession(); navigate('/login'); }
        else if (error.response?.status === 403) navigate('/onboarding');
        else toast.error(error.response?.data?.error || 'โหลดข้อมูลร้านไม่สำเร็จ');
    }), [navigate]);

    useEffect(() => {
        if (!getAccountToken()) { navigate('/login'); return; }
        load();
    }, [load, navigate]);

    const save = async event => {
        event?.preventDefault();
        setSaving(true);
        try {
            const payload = { ...form, proofUrls: form.proofUrls.filter(Boolean) };
            const { data } = await api.put('/merchant/store', payload);
            setStatus(data);
            toast.success('บันทึกข้อมูลร้านแล้ว');
            return data;
        } catch (error) {
            toast.error(error.response?.data?.error || 'บันทึกข้อมูลร้านไม่สำเร็จ');
            return null;
        } finally {
            setSaving(false);
        }
    };

    const submitReview = async () => {
        try {
            const saved = await save();
            if (!saved) return;
            const { data } = await api.post('/merchant/store/submit');
            setStatus(data);
            toast.success('ส่งร้านให้ตรวจสอบแล้ว');
        } catch (error) {
            const missing = error.response?.data?.missing;
            if (missing) toast.error(`ข้อมูลยังไม่ครบ: ${missing.map(item => missingLabels[item] || item).join(', ')}`);
            else toast.error(error.response?.data?.error || 'ส่งตรวจสอบไม่สำเร็จ');
        }
    };

    if (!status) return <><MerchantNav /><div className="card">กำลังโหลด...</div></>;
    const locked = ['pending_verification', 'suspended'].includes(status.verificationStatus);

    return (
        <>
            <MerchantNav />
            <div className="card" style={{ maxWidth: 760, margin: '20px auto', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 15, alignItems: 'flex-start' }}>
                    <div><h2>ข้อมูลร้านค้า</h2><p style={{ color: 'var(--text-light)', marginTop: 6 }}>Store ID: <code>{status.storeId}</code></p></div>
                    <span className="status-badge status-called">{status.verificationStatus}</span>
                </div>
                {status.informationRequest && <Notice color="#92400e" background="#fef3c7">ต้องการข้อมูลเพิ่ม: {status.informationRequest}</Notice>}
                {status.rejectionReason && <Notice color="#991b1b" background="#fee2e2">เหตุผลที่ไม่ผ่าน: {status.rejectionReason}</Notice>}
                {locked ? (
                    <Notice color="#334155" background="#e2e8f0">ข้อมูลถูกล็อกระหว่างตรวจสอบ หากต้องแก้ไขโปรดรอผลหรือให้ผู้ดูแลขอข้อมูลเพิ่ม</Notice>
                ) : (
                    <form onSubmit={save} style={{ marginTop: 24 }}>
                        <div className="grid-2">
                            <Field label="ชื่อร้าน *" value={form.name} onChange={name => setForm({ ...form, name })} />
                            <Field label="Slug *" value={form.slug} onChange={slug => setForm({ ...form, slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
                        </div>
                        <Field label="เบอร์โทรร้าน *" value={form.phone} onChange={phone => setForm({ ...form, phone })} />
                        <Field label="ที่อยู่ร้าน *" value={form.address} onChange={address => setForm({ ...form, address })} />
                        <Field label="Google Maps URL" type="url" value={form.googleMapsUrl} onChange={googleMapsUrl => setForm({ ...form, googleMapsUrl })} />
                        <div className="grid-2">
                            <Field label="ละติจูด" type="number" value={form.latitude} onChange={latitude => setForm({ ...form, latitude })} />
                            <Field label="ลองจิจูด" type="number" value={form.longitude} onChange={longitude => setForm({ ...form, longitude })} />
                        </div>
                        <Field label="รูปหน้าร้าน URL *" type="url" value={form.storefrontPhotoUrl} onChange={storefrontPhotoUrl => setForm({ ...form, storefrontPhotoUrl })} />
                        <Field label="Facebook Page หรือช่องทางออนไลน์ *" type="url" value={form.onlineChannelUrl} onChange={onlineChannelUrl => setForm({ ...form, onlineChannelUrl })} />
                        <Field label="Logo URL" type="url" value={form.logoUrl} onChange={logoUrl => setForm({ ...form, logoUrl })} />
                        <Field label="หลักฐานเพิ่มเติม URL" type="url" value={form.proofUrls[0] || ''} onChange={value => setForm({ ...form, proofUrls: [value] })} />
                        <div className="input-group"><label>รายละเอียดร้าน</label><textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} rows="4" style={inputStyle} /></div>
                        <label style={{ display: 'flex', gap: 10, marginBottom: 20 }}><input type="checkbox" checked={form.acceptedTerms} onChange={event => setForm({ ...form, acceptedTerms: event.target.checked })} /><span>ยืนยันว่าข้อมูลถูกต้องและยอมรับข้อกำหนด</span></label>
                        <button className="btn btn-secondary" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}</button>
                        <button type="button" className="btn btn-primary" style={{ marginTop: 10 }} disabled={saving} onClick={submitReview}>ส่งตรวจสอบร้าน</button>
                    </form>
                )}
            </div>
        </>
    );
}

const inputStyle = { width: '100%', padding: 12, border: '2px solid #e2e8f0', borderRadius: 12, fontSize: '1rem' };
function Field({ label, type = 'text', value, onChange }) {
    return <div className="input-group"><label>{label}</label><input type={type} step={type === 'number' ? 'any' : undefined} value={value ?? ''} onChange={event => onChange(event.target.value)} /></div>;
}
function Notice({ children, color, background }) {
    return <div style={{ color, background, borderRadius: 10, padding: 12, marginTop: 16 }}>{children}</div>;
}
