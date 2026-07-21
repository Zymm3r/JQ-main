import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LogIn, Phone, QrCode, User, Users } from 'lucide-react';
import liff from '@line/liff';
import toast from 'react-hot-toast';
import { api } from '../api';

function makeIdempotencyKey() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `reserve-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

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
    const [idempotencyKey, setIdempotencyKey] = useState(() => makeIdempotencyKey());

    useEffect(() => {
        if (!liffSlug) {
            setLineReady(true);
            return;
        }
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
        }).catch(error => {
            setLineReady(true);
            toast.error(error.response?.data?.error || 'Store not found');
        });
    }, [liffSlug, source]);

    const login = () => liff.login({ redirectUri: window.location.href });
    const submit = async event => {
        event.preventDefault();
        if (!form.customerName.trim()) return toast.error('Required: Name');
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
            toast.success('Reservation Success!');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Failed to reserve');
        } finally {
            setSubmitting(false);
        }
    };

    if (!lineReady) return <LiffShell><LoadingState /></LiffShell>;
    if (!liffSlug) return <LiffShell><EmptyStoreState /></LiffShell>;
    if (!store) return <LiffShell><EmptyStoreState /></LiffShell>;
    if (queue) return <LiffShell store={store} profile={profile}><SuccessState queue={queue} liffSlug={liffSlug} /></LiffShell>;
    if (store.liffId && !profile) return <LiffShell store={store}><LineLoginState onLogin={login} /></LiffShell>;

    return <LiffShell store={store} profile={profile}>
        <form onSubmit={submit}>
            <p style={{ color: 'var(--text-light)', textAlign: 'center', marginBottom: 20 }}>
                Scan point: {store.sourceName}
            </p>

            <div className="input-group">
                <label><User size={18} /> Name *</label>
                <input
                    required
                    maxLength="120"
                    placeholder="Ex. Somchai"
                    value={form.customerName}
                    onChange={event => setForm({ ...form, customerName: event.target.value })}
                    disabled={Boolean(profile)}
                    style={{ background: profile ? '#f1f5f9' : 'white' }}
                />
            </div>

            <div className="input-group">
                <label><Phone size={18} /> Phone</label>
                <input
                    type="tel"
                    maxLength="30"
                    placeholder="08x xxx xxxx"
                    value={form.phoneNumber}
                    onChange={event => setForm({ ...form, phoneNumber: event.target.value })}
                />
            </div>

            <div className="input-group">
                <label><Users size={18} /> Pax</label>
                <select
                    value={form.pax}
                    onChange={event => setForm({ ...form, pax: Number(event.target.value) })}
                    style={selectStyle}
                >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(value => <option key={value} value={value}>{value} people</option>)}
                </select>
            </div>

            <button type="submit" className="btn btn-primary" disabled={submitting || !store.queueOpen} style={{ marginTop: 10 }}>
                {store.queueOpen ? (submitting ? 'Reserving...' : 'Get Queue') : 'Queue is closed'}
            </button>
        </form>
    </LiffShell>;
}

function LiffShell({ store, profile, children }) {
    return <div className="card" style={{ maxWidth: 500, margin: '40px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20, color: 'var(--primary)' }}>
                {profile?.pictureUrl ? (
                    <img src={profile.pictureUrl} alt="Profile" style={avatarStyle} />
                ) : store?.logoUrl ? (
                    <img src={store.logoUrl} alt={store.name || 'Store'} style={{ ...avatarStyle, borderRadius: 20 }} />
                ) : (
                    <QrCode size={64} />
                )}
            </div>
            <h2>{store?.name || 'Queue Store'}</h2>
            <p style={{ color: 'var(--text-light)' }}>
                {profile ? `Welcome, ${profile.displayName}` : (store?.description || 'Fast online queue booking')}
            </p>
        </div>
        {children}
    </div>;
}

function LoadingState() {
    return <p style={{ color: 'var(--text-light)', textAlign: 'center' }}>Opening store...</p>;
}

function EmptyStoreState() {
    return <div style={{ textAlign: 'center' }}>
        <p style={{ color: 'var(--text-light)', marginBottom: 16 }}>
            This booking link needs a store code.
        </p>
        <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>
            Please scan the store QR code again.
        </p>
    </div>;
}

function LineLoginState({ onLogin }) {
    return <div style={{ marginBottom: 20, textAlign: 'center' }}>
        <button type="button" onClick={onLogin} className="btn" style={lineButtonStyle}>
            <LogIn size={20} /> Login with LINE
        </button>
        <div style={{ margin: '15px 0', position: 'relative' }}>
            <span style={{ background: 'white', padding: '0 10px', color: 'var(--text-light)', fontSize: '0.8rem' }}>
                Use LINE to continue
            </span>
        </div>
    </div>;
}

function SuccessState({ queue, liffSlug }) {
    const queueAhead = Number.isFinite(queue.queueAhead) ? queue.queueAhead : null;
    return <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 18, color: 'var(--success)', fontWeight: 700 }}>Reservation Success!</div>
        <div style={{ fontSize: 72, fontWeight: 800, color: 'var(--primary)', margin: 12 }}>Q{queue.queueNumber}</div>
        <p style={{ color: 'var(--text-light)', marginBottom: 18 }}>
            Estimated wait {queue.estimatedWaitTime || 0} minutes{queueAhead !== null ? ` · ${queueAhead} ahead` : ''}
        </p>
        <Link className="btn btn-primary" to={`/liff/${liffSlug}/status/${queue.publicToken}`}>Track Queue</Link>
        <button className="btn btn-secondary" style={{ marginTop: 10 }} onClick={() => navigator.clipboard.writeText(queue.trackingUrl)}>
            Copy Tracking Link
        </button>
    </div>;
}

const avatarStyle = {
    width: 80,
    height: 80,
    borderRadius: '50%',
    border: '4px solid var(--primary-light, #e0e7ff)',
    objectFit: 'cover'
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

const selectStyle = {
    width: '100%',
    padding: 12,
    border: '2px solid #e2e8f0',
    borderRadius: 12,
    fontSize: '1rem',
    outline: 'none',
    background: 'white'
};
