import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../api';

export default function LiffStatus() {
    const { liffSlug, publicToken } = useParams();
    const [params] = useSearchParams();
    const [queue, setQueue] = useState(null);
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);

    useEffect(() => {
        const load = () => api.get(`/public/stores/${encodeURIComponent(liffSlug)}/status/${encodeURIComponent(publicToken)}`)
            .then(({ data }) => {
                setQueue(data);
                setError('');
            })
            .catch(err => setError(errorText(err.response?.data?.error, 'ไม่พบคิวนี้')));

        load();
        const timer = setInterval(load, 15000);
        return () => clearInterval(timer);
    }, [liffSlug, publicToken]);

    const cancelQueue = async () => {
        if (!window.confirm('ยืนยันยกเลิกคิวนี้?')) return;
        setCancelling(true);
        try {
            const { data } = await api.post(`/public/stores/${encodeURIComponent(liffSlug)}/status/${encodeURIComponent(publicToken)}/cancel`);
            setQueue(data);
            setError('');
        } catch (err) {
            setError(errorText(err.response?.data?.error, 'ยกเลิกคิวไม่สำเร็จ'));
        } finally {
            setCancelling(false);
        }
    };

    return (
        <main style={pageStyle}>
            <section className="card" style={panelStyle}>
                {error ? (
                    <StateIcon icon={<XCircle size={48} color="#dc2626" />} title={error} text="กรุณาตรวจสอบลิงก์อีกครั้ง หรือสอบถามพนักงานหน้าร้าน" />
                ) : !queue ? (
                    <StateIcon icon={<RefreshCw size={44} color="#2563eb" />} title="กำลังโหลดสถานะคิว..." text="หน้านี้จะอัปเดตสถานะให้อัตโนมัติ" />
                ) : (
                    <>
                        <div style={{ color: '#64748b', fontWeight: 700 }}>หมายเลขคิวของคุณ</div>
                        <div style={{ fontSize: 78, fontWeight: 900, color: '#2563eb', margin: '6px 0' }}>Q{queue.queueNumber}</div>
                        <h1 style={{ marginBottom: 8 }}>{statusText[queue.status] || queue.status}</h1>

                        {queue.status === 'waiting' && (
                            <p style={mutedStyle}>
                                <Clock size={18} /> เวลารอโดยประมาณ {queue.estimatedWaitTime || 0} นาที
                            </p>
                        )}

                        {queue.status === 'called' && (
                            <p style={{ ...mutedStyle, color: '#b45309' }}>
                                ถึงคิวแล้ว กรุณาติดต่อพนักงานหน้าร้าน
                            </p>
                        )}

                        {['completed', 'cancelled'].includes(queue.status) && (
                            <p style={mutedStyle}>ขอบคุณที่ใช้บริการ</p>
                        )}

                        {['waiting', 'called'].includes(queue.status) && (
                            <button
                                className="btn btn-secondary"
                                style={{ color: '#dc2626', marginTop: 18 }}
                                disabled={cancelling}
                                autoFocus={params.get('cancel') === '1'}
                                onClick={cancelQueue}
                            >
                                {cancelling ? 'กำลังยกเลิกคิว...' : 'ยกเลิกคิว'}
                            </button>
                        )}

                        <div style={noticeStyle}>
                            <CheckCircle2 size={18} color="#16a34a" />
                            <span>หน้านี้อัปเดตอัตโนมัติทุก 15 วินาที</span>
                        </div>
                    </>
                )}
            </section>
        </main>
    );
}

function StateIcon({ icon, title, text }) {
    return (
        <>
            {icon}
            <h1 style={{ marginTop: 14 }}>{title}</h1>
            <p style={mutedStyle}>{text}</p>
        </>
    );
}

function errorText(value, fallback) {
    const map = {
        'Queue not found': 'ไม่พบคิวนี้',
        'Queue not found or cannot be cancelled': 'ไม่พบคิว หรือคิวนี้ไม่สามารถยกเลิกได้'
    };
    return map[value] || fallback;
}

const statusText = {
    waiting: 'กำลังรอคิว',
    called: 'ถึงคิวแล้ว',
    dining: 'เข้ารับบริการแล้ว',
    completed: 'เสร็จสิ้น',
    cancelled: 'ยกเลิกแล้ว'
};

const pageStyle = {
    minHeight: '100vh',
    maxWidth: 720,
    margin: '0 auto',
    padding: '32px 16px 48px'
};

const panelStyle = {
    textAlign: 'center',
    padding: 28,
    background: 'linear-gradient(135deg, #ffffff 0%, #eff6ff 100%)'
};

const mutedStyle = {
    color: '#64748b',
    lineHeight: 1.6,
    marginTop: 8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexWrap: 'wrap'
};

const noticeStyle = {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    color: '#64748b',
    fontSize: 14,
    marginTop: 18
};
