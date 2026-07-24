import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, LogIn, MessageCircle, Phone, QrCode, ShieldCheck, User, Users } from 'lucide-react';
import liff from '@line/liff';
import toast from 'react-hot-toast';
import { api } from '../api';

function makeIdempotencyKey() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `reserve-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function resolveLiffTarget(routeSlug, params) {
    const fromQuery = params.get('store');
    const rawState = params.get('liff.state') || '';
    let stateSlug = '';
    let stateSource = '';

    if (rawState) {
        try {
            const stateUrl = new URL(rawState, window.location.origin);
            const segments = stateUrl.pathname.split('/').filter(Boolean);
            const cleanSegments = segments[0] === 'liff' ? segments.slice(1) : segments;
            stateSlug = cleanSegments[0] || '';
            stateSource = stateUrl.searchParams.get('source') || '';
        } catch {
            const [pathPart, queryPart] = rawState.split('?');
            const segments = String(pathPart || '').split('/').filter(Boolean);
            const cleanSegments = segments[0] === 'liff' ? segments.slice(1) : segments;
            stateSlug = cleanSegments[0] || '';
            stateSource = new URLSearchParams(queryPart || '').get('source') || '';
        }
    }

    return {
        liffSlug: routeSlug || fromQuery || stateSlug,
        source: params.get('source') || stateSource || 'main'
    };
}

function errorText(value, fallback = 'ทำรายการไม่สำเร็จ') {
    const map = {
        'Store not found': 'ไม่พบร้านนี้ กรุณาสแกน QR ใหม่อีกครั้ง',
        'QR source not found': 'ไม่พบ QR ของร้านนี้ กรุณาสแกน QR ใหม่อีกครั้ง',
        'Customer name is required': 'กรุณากรอกชื่อ',
        'Pax must be an integer from 1 to 100': 'จำนวนคนต้องอยู่ระหว่าง 1-100 คน',
        'Phone number is too long': 'เบอร์โทรศัพท์ยาวเกินไป',
        LINE_LOGIN_REQUIRED: 'กรุณาเข้าสู่ระบบด้วย LINE ก่อนรับคิว',
        INVALID_LINE_SESSION: 'เซสชัน LINE หมดอายุ กรุณาเข้าสู่ระบบใหม่',
        NO_ACTIVE_SESSION: 'ร้านยังไม่เปิดรับคิวในขณะนี้',
        QUEUE_CLOSED: 'ร้านปิดรับคิวชั่วคราว',
        QUEUE_FULL: 'คิวเต็มแล้ว กรุณาลองใหม่ภายหลัง',
        ACTIVE_QUEUE_EXISTS: 'คุณมีคิวที่ยังใช้งานอยู่แล้ว'
    };
    return map[value] || fallback;
}

export default function LiffQueue() {
    const { liffSlug: routeSlug } = useParams();
    const [params] = useSearchParams();
    const { liffSlug, source } = resolveLiffTarget(routeSlug, params);
    const [store, setStore] = useState(null);
    const [profile, setProfile] = useState(null);
    const [lineReady, setLineReady] = useState(false);
    const [form, setForm] = useState({ customerName: '', pax: 1, phoneNumber: '' });
    const [queue, setQueue] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [idempotencyKey, setIdempotencyKey] = useState(() => makeIdempotencyKey());

    useEffect(() => {
        if (!liffSlug) {
            setLineReady(true);
            return;
        }

        api.get(`/public/stores/${encodeURIComponent(liffSlug)}/info`, { params: { source } }).then(async ({ data }) => {
            setStore(data);
            if (!data.liffId) {
                setLineReady(true);
                return;
            }

            await liff.init({ liffId: data.liffId });
            if (liff.isLoggedIn()) {
                const value = await liff.getProfile();
                setProfile(value);
                setForm(current => ({ ...current, customerName: current.customerName || value.displayName || '' }));
            }
            setLineReady(true);
        }).catch(error => {
            setLineReady(true);
            toast.error(errorText(error.response?.data?.error, 'ไม่พบร้านนี้ กรุณาสแกน QR ใหม่อีกครั้ง'));
        });
    }, [liffSlug, source]);

    const login = () => {
        const cleanUrl = `${window.location.origin}/liff/${encodeURIComponent(liffSlug)}?source=${encodeURIComponent(source)}`;
        liff.login({ redirectUri: cleanUrl });
    };

    const submit = async event => {
        event.preventDefault();
        if (!form.customerName.trim()) return toast.error('กรุณากรอกชื่อ');

        setSubmitting(true);
        try {
            const accessToken = store.liffId ? liff.getAccessToken() : null;
            const { data } = await api.post(`/public/stores/${encodeURIComponent(liffSlug)}/reserve`, { ...form, source }, {
                headers: {
                    ...(accessToken ? { 'x-line-access-token': accessToken } : {}),
                    'Idempotency-Key': idempotencyKey
                }
            });
            setQueue(data);
            setIdempotencyKey(makeIdempotencyKey());
            toast.success('รับคิวสำเร็จ');
        } catch (error) {
            toast.error(errorText(error.response?.data?.error));
        } finally {
            setSubmitting(false);
        }
    };

    if (!lineReady) return <LiffPage store={store}><LoadingState /></LiffPage>;
    if (!liffSlug || !store) return <LiffPage><EmptyStoreState /></LiffPage>;
    if (queue) return <LiffPage store={store} profile={profile}><SuccessState queue={queue} liffSlug={liffSlug} /></LiffPage>;
    if (store.liffId && !profile) return <LiffPage store={store}><LineLoginState store={store} onLogin={login} /></LiffPage>;

    return (
        <LiffPage store={store} profile={profile}>
            <QueueForm
                form={form}
                profile={profile}
                queueOpen={store.queueOpen}
                sourceName={store.sourceName}
                submitting={submitting}
                onSubmit={submit}
                onChange={setForm}
            />
        </LiffPage>
    );
}

function LiffPage({ store, profile, children }) {
    return (
        <main style={pageStyle}>
            <section style={heroStyle}>
                <div style={brandStyle}>
                    <QrCode size={20} />
                    รับคิวออนไลน์ผ่าน LINE
                </div>

                <div style={storeIdentityStyle}>
                    {profile?.pictureUrl ? (
                        <img src={profile.pictureUrl} alt="LINE profile" style={avatarStyle} />
                    ) : store?.logoUrl ? (
                        <img src={store.logoUrl} alt={store.name || 'ร้านค้า'} style={{ ...avatarStyle, borderRadius: 22 }} />
                    ) : (
                        <div style={qrAvatarStyle}><QrCode size={42} /></div>
                    )}
                    <div>
                        <h1 style={titleStyle}>{store?.name || 'เลือกร้านจาก QR Code'}</h1>
                        <p style={subtitleStyle}>
                            {profile
                                ? `สวัสดีคุณ ${profile.displayName} พร้อมรับคิวได้เลย`
                                : 'สแกน QR ของร้าน เข้าสู่ระบบด้วย LINE แล้วรับบัตรคิวได้ทันที'}
                        </p>
                    </div>
                </div>

                <div style={infoGridStyle}>
                    <InfoPill icon={<MessageCircle size={18} />} title="แจ้งเตือนผ่าน LINE" text="ระบบจะส่งข้อความยืนยันและเรียกคิวจากบัญชี LINE กลาง" />
                    <InfoPill icon={<ShieldCheck size={18} />} title="คิวของร้านนี้เท่านั้น" text="QR นี้ผูกกับร้านและจุดสแกนโดยเฉพาะ ข้อมูลไม่ปนกับร้านอื่น" />
                </div>
            </section>

            <section className="card" style={panelStyle}>
                {children}
            </section>
        </main>
    );
}

function InfoPill({ icon, title, text }) {
    return (
        <div style={infoPillStyle}>
            <div style={{ color: '#2563eb', marginTop: 2 }}>{icon}</div>
            <div>
                <strong>{title}</strong>
                <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.45, marginTop: 3 }}>{text}</p>
            </div>
        </div>
    );
}

function LoadingState() {
    return (
        <div style={centerStyle}>
            <QrCode size={44} color="#2563eb" />
            <h2 style={{ marginTop: 14 }}>กำลังเปิดหน้าร้าน...</h2>
            <p style={mutedStyle}>กรุณารอสักครู่ ระบบกำลังตรวจสอบ QR ของร้าน</p>
        </div>
    );
}

function EmptyStoreState() {
    return (
        <div style={centerStyle}>
            <QrCode size={44} color="#dc2626" />
            <h2 style={{ marginTop: 14 }}>ไม่พบร้านจากลิงก์นี้</h2>
            <p style={mutedStyle}>กรุณาสแกน QR Code ของร้านอีกครั้ง หรือสอบถามพนักงานหน้าร้าน</p>
        </div>
    );
}

function LineLoginState({ store, onLogin }) {
    return (
        <div>
            <div style={sectionHeaderStyle}>
                <h2>เข้าสู่ระบบเพื่อรับคิว</h2>
                <p style={mutedStyle}>
                    ใช้ LINE เพื่อยืนยันตัวตน และรับข้อความแจ้งเตือนเมื่อถึงคิวของคุณ
                </p>
            </div>

            <button type="button" onClick={onLogin} className="btn" style={lineButtonStyle}>
                <LogIn size={20} /> เข้าสู่ระบบด้วย LINE
            </button>

            <div style={noticeStyle}>
                <CheckCircle2 size={18} color="#16a34a" />
                <span>หลังเข้าสู่ระบบ คุณจะรับคิวของ {store?.name || 'ร้านนี้'} ได้ทันที</span>
            </div>
        </div>
    );
}

function QueueForm({ form, profile, queueOpen, sourceName, submitting, onSubmit, onChange }) {
    return (
        <form onSubmit={onSubmit}>
            <div style={sectionHeaderStyle}>
                <h2>กรอกข้อมูลรับคิว</h2>
                <p style={mutedStyle}>
                    จุดสแกน: {sourceName || 'QR หลักของร้าน'}
                </p>
            </div>

            <div className="input-group">
                <label style={labelStyle}><User size={18} /> ชื่อผู้รับคิว *</label>
                <input
                    required
                    maxLength="120"
                    placeholder="เช่น สมชาย"
                    value={form.customerName}
                    onChange={event => onChange({ ...form, customerName: event.target.value })}
                    disabled={Boolean(profile)}
                    style={{ background: profile ? '#f1f5f9' : 'white' }}
                />
            </div>

            <div className="input-group">
                <label style={labelStyle}><Phone size={18} /> เบอร์โทรศัพท์</label>
                <input
                    type="tel"
                    maxLength="30"
                    placeholder="08x xxx xxxx"
                    value={form.phoneNumber}
                    onChange={event => onChange({ ...form, phoneNumber: event.target.value })}
                />
            </div>

            <div className="input-group">
                <label style={labelStyle}><Users size={18} /> จำนวนคน</label>
                <select value={form.pax} onChange={event => onChange({ ...form, pax: Number(event.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(value => <option key={value} value={value}>{value} คน</option>)}
                </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting || !queueOpen} style={{ marginTop: 10 }}>
                {queueOpen ? (submitting ? 'กำลังรับคิว...' : 'รับบัตรคิว') : 'ร้านปิดรับคิวชั่วคราว'}
            </button>
        </form>
    );
}

function SuccessState({ queue, liffSlug }) {
    const queueAhead = Number.isFinite(queue.queueAhead) ? queue.queueAhead : null;
    return (
        <div style={centerStyle}>
            <CheckCircle2 size={48} color="#16a34a" />
            <h2 style={{ marginTop: 12, color: '#16a34a' }}>รับคิวสำเร็จ</h2>
            <div style={{ fontSize: 76, fontWeight: 900, color: '#2563eb', margin: '8px 0' }}>Q{queue.queueNumber}</div>
            <p style={mutedStyle}>
                เวลารอโดยประมาณ {queue.estimatedWaitTime || 0} นาที{queueAhead !== null ? ` · เหลืออีก ${queueAhead} คิวก่อนหน้า` : ''}
            </p>
            <Link className="btn btn-primary" to={`/liff/${liffSlug}/status/${queue.publicToken}`} style={{ marginTop: 18, textDecoration: 'none' }}>
                ดูสถานะคิว
            </Link>
            <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => navigator.clipboard.writeText(queue.trackingUrl)}>
                คัดลอกลิงก์ติดตามคิว
            </button>
        </div>
    );
}

const pageStyle = {
    minHeight: '100vh',
    maxWidth: 980,
    margin: '0 auto',
    padding: '28px 16px 48px'
};

const heroStyle = {
    borderRadius: 28,
    padding: 24,
    background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 50%, #f0fdf4 100%)',
    border: '1px solid #dbeafe',
    boxShadow: 'var(--shadow)',
    marginBottom: 18
};

const brandStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    color: '#2563eb',
    fontWeight: 800,
    marginBottom: 18
};

const storeIdentityStyle = {
    display: 'grid',
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    gap: 16,
    alignItems: 'center'
};

const titleStyle = {
    fontSize: 'clamp(2rem, 8vw, 3.8rem)',
    lineHeight: 1.06,
    margin: 0
};

const subtitleStyle = {
    color: '#475569',
    fontSize: '1.05rem',
    lineHeight: 1.65,
    marginTop: 10
};

const avatarStyle = {
    width: 82,
    height: 82,
    borderRadius: '50%',
    border: '4px solid #dbeafe',
    objectFit: 'cover',
    background: 'white'
};

const qrAvatarStyle = {
    ...avatarStyle,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#2563eb'
};

const infoGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 12,
    marginTop: 22
};

const infoPillStyle = {
    display: 'flex',
    gap: 10,
    background: 'rgba(255,255,255,0.82)',
    border: '1px solid #e2e8f0',
    borderRadius: 16,
    padding: 14
};

const panelStyle = {
    maxWidth: 560,
    margin: '0 auto',
    padding: 24
};

const sectionHeaderStyle = {
    textAlign: 'center',
    marginBottom: 22
};

const centerStyle = {
    textAlign: 'center'
};

const mutedStyle = {
    color: '#64748b',
    lineHeight: 1.6,
    marginTop: 8
};

const labelStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: 8
};

const lineButtonStyle = {
    background: '#06C755',
    color: 'white',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10
};

const noticeStyle = {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginTop: 16,
    color: '#475569',
    fontSize: 14,
    lineHeight: 1.5
};
