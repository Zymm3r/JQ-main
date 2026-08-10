import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import { api } from '../api';

const statusText = {
    waiting: 'กำลังรอเรียกคิว',
    called: 'ถึงคิวแล้ว',
    dining: 'รับเข้าร้านแล้ว',
    completed: 'ใช้บริการเสร็จแล้ว',
    cancelled: 'ยกเลิกคิวแล้ว'
};

export default function LiffStatus() {
    const { liffSlug, publicToken } = useParams();
    const [params] = useSearchParams();
    const [queue, setQueue] = useState(null);
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);
    const [clockOffset, setClockOffset] = useState(0);
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        let stopped = false;
        let timer;
        const load = async () => {
            try {
                const { data } = await api.get(`/public/stores/${encodeURIComponent(liffSlug)}/status/${encodeURIComponent(publicToken)}`);
                if (stopped) return;
                setQueue(data);
                setError('');
                if (data.serverTime) setClockOffset(new Date(data.serverTime).getTime() - Date.now());
            } catch (err) {
                if (!stopped) setError(errorText(err.response?.data?.error, 'ไม่พบคิวนี้'));
            } finally {
                if (!stopped) timer = setTimeout(load, 5_000);
            }
        };
        load();
        return () => { stopped = true; clearTimeout(timer); };
    }, [liffSlug, publicToken]);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now() + clockOffset), 1_000);
        return () => clearInterval(timer);
    }, [clockOffset]);

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

    const arrivalRemaining = queue?.status === 'called' && queue.seatDeadlineAt
        ? new Date(queue.seatDeadlineAt).getTime() - now
        : null;

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
                        {queue.status === 'waiting' && <p style={mutedStyle}><Clock size={18} /> เวลารอโดยประมาณ {queue.estimatedWaitTime || 0} นาที</p>}
                        {queue.status === 'called' && (
                            <div style={{ ...noticeStyle, background: arrivalRemaining <= 0 ? '#fee2e2' : '#fff7ed', color: arrivalRemaining <= 0 ? '#b91c1c' : '#9a3412' }}>
                                <Clock size={18} />
                                <span>{arrivalRemaining <= 0 ? 'เกินเวลารับเข้าร้าน กรุณาติดต่อพนักงาน' : `กรุณามาถึงร้านภายใน ${formatDuration(arrivalRemaining)}`}</span>
                            </div>
                        )}
                        {['completed', 'cancelled'].includes(queue.status) && <p style={mutedStyle}>ขอบคุณที่ใช้บริการ</p>}
                        {['waiting', 'called'].includes(queue.status) && (
                            <button className="btn btn-secondary" style={{ color: '#dc2626', marginTop: 18 }} disabled={cancelling} autoFocus={params.get('cancel') === '1'} onClick={cancelQueue}>
                                {cancelling ? 'กำลังยกเลิกคิว...' : 'ยกเลิกคิว'}
                            </button>
                        )}
                        <div style={noticeStyle}><CheckCircle2 size={18} color="#16a34a" /><span>สถานะอัปเดตอัตโนมัติทุก 5 วินาที</span></div>
                    </>
                )}
            </section>
        </main>
    );
}

function StateIcon({ icon, title, text }) {
    return <>{icon}<h1 style={{ marginTop: 14 }}>{title}</h1><p style={mutedStyle}>{text}</p></>;
}

function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} นาที`;
}

function errorText(code, fallback) {
    const errors = { 'Queue not found': 'ไม่พบคิวนี้', 'Queue not found or cannot be cancelled': 'คิวนี้ไม่สามารถยกเลิกได้' };
    return errors[code] || fallback;
}

const pageStyle = { minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 18, background: '#eff6ff' };
const panelStyle = { width: 'min(100%, 520px)', textAlign: 'center', padding: 28 };
const mutedStyle = { color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 };
const noticeStyle = { marginTop: 18, padding: 12, borderRadius: 10, background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 };
