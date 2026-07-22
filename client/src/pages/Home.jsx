import { Link } from 'react-router-dom';
import { CheckCircle2, LineChart, MessageCircle, QrCode, ShieldCheck, Store, Users } from 'lucide-react';

const steps = [
    ['1', 'Merchant registers', 'Create a store account, add store details, and submit for platform verification.'],
    ['2', 'Platform verifies', 'The intermediary reviews the store before its LIFF booking page can accept queues.'],
    ['3', 'Store prints QR', 'Each store gets a unique QR/LIFF link. Customers scan it with LINE and book instantly.'],
    ['4', 'Central LINE OA notifies', 'Queue confirmations and calls are sent from the platform LINE Official Account.']
];

const features = [
    [QrCode, 'Unique QR per store', 'Every QR resolves to a verified store slug and source.'],
    [MessageCircle, 'Central LINE notifications', 'Merchants do not need to connect their own LINE OA for MVP.'],
    [ShieldCheck, 'Tenant-safe access', 'Merchant APIs use the token storeId, not a trusted request body storeId.'],
    [Users, 'Staff-ready structure', 'Owner, manager, staff, and viewer roles can be added without reshaping the app.']
];

export default function Home() {
    return (
        <main style={{ maxWidth: 980, margin: '0 auto', padding: '36px 18px 56px' }}>
            <section className="card" style={{
                padding: 32,
                background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 46%, #f0fdf4 100%)',
                border: '1px solid #dbeafe'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#2563eb', fontWeight: 800, marginBottom: 18 }}>
                    <Store size={22} />
                    JQ Intermediary Queue Platform
                </div>
                <h1 style={{ fontSize: 'clamp(2rem, 6vw, 4rem)', lineHeight: 1.04, marginBottom: 18 }}>
                    Queue booking through LINE, without making every merchant run their own bot.
                </h1>
                <p style={{ color: '#475569', fontSize: '1.08rem', lineHeight: 1.7, maxWidth: 760 }}>
                    Merchants register and verify their store. Customers scan the store QR, book through LINE LIFF,
                    and receive queue notifications from the platform’s central LINE Official Account.
                </p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
                    <Link className="btn btn-primary" to="/register" style={{ width: 'auto', textDecoration: 'none' }}>Register merchant</Link>
                    <Link className="btn btn-secondary" to="/login" style={{ width: 'auto', textDecoration: 'none' }}>Merchant login</Link>
                    <Link className="btn btn-secondary" to="/liff/demo-shabu-1?source=main" style={{ width: 'auto', textDecoration: 'none' }}>View demo LIFF</Link>
                </div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginTop: 18 }}>
                {features.map(([Icon, title, text]) => (
                    <div className="card" key={title} style={{ padding: 20 }}>
                        <Icon size={26} color="#2563eb" />
                        <h3 style={{ marginTop: 12 }}>{title}</h3>
                        <p style={{ color: '#64748b', lineHeight: 1.55, marginTop: 8 }}>{text}</p>
                    </div>
                ))}
            </section>

            <section className="card" style={{ marginTop: 18, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                    <LineChart color="#16a34a" />
                    <h2>Simple MVP flow</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                    {steps.map(([number, title, text]) => (
                        <div key={number} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
                            <div style={{
                                width: 34, height: 34, borderRadius: 17, background: '#dbeafe', color: '#1d4ed8',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                            }}>{number}</div>
                            <h3 style={{ marginTop: 12 }}>{title}</h3>
                            <p style={{ color: '#64748b', lineHeight: 1.55, marginTop: 8 }}>{text}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="card" style={{ marginTop: 18, padding: 22, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <CheckCircle2 color="#16a34a" />
                <div>
                    <h3>Current rule</h3>
                    <p style={{ color: '#64748b', lineHeight: 1.6, marginTop: 6 }}>
                        This build keeps the platform free for merchants: LINE usage is tracked for operations,
                        but subscription/package limits are not used to block queue actions.
                    </p>
                </div>
            </section>
        </main>
    );
}
