import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';

export default function LiffStatus() {
    const { liffSlug, publicToken } = useParams();
    const [params] = useSearchParams();
    const [queue, setQueue] = useState(null);
    const [error, setError] = useState('');
    const [cancelling, setCancelling] = useState(false);
    useEffect(() => {
        const load = () => api.get(`/public/stores/${encodeURIComponent(liffSlug)}/status/${encodeURIComponent(publicToken)}`).then(({ data }) => setQueue(data)).catch(err => setError(err.response?.data?.error || 'ไม่พบคิว'));
        load(); const timer = setInterval(load, 15000); return () => clearInterval(timer);
    }, [liffSlug, publicToken]);
    const cancelQueue = async () => {
        if (!window.confirm('ยืนยันยกเลิกคิว?')) return;
        setCancelling(true);
        try {
            const { data } = await api.post(`/public/stores/${encodeURIComponent(liffSlug)}/status/${encodeURIComponent(publicToken)}/cancel`);
            setQueue(data);
        } catch (err) {
            setError(err.response?.data?.error || 'ยกเลิกคิวไม่สำเร็จ');
        } finally {
            setCancelling(false);
        }
    };
    return <main style={{ minHeight: '100vh', background: '#eff6ff', padding: 20 }}><div className="card" style={{ maxWidth: 440, margin: '30px auto', textAlign: 'center' }}>
        {error ? <h2>{error}</h2> : !queue ? <p>กำลังโหลด...</p> : <><div style={{ color: '#64748b' }}>หมายเลขคิว</div><div style={{ fontSize: 72, fontWeight: 800, color: '#2563eb' }}>Q{queue.queueNumber}</div><h2>{statusText[queue.status] || queue.status}</h2>{queue.status === 'waiting' && <p>เวลารอโดยประมาณ {queue.estimatedWaitTime} นาที</p>}{['waiting', 'called'].includes(queue.status) && <button className="btn btn-secondary" style={{ color: '#dc2626' }} disabled={cancelling} autoFocus={params.get('cancel') === '1'} onClick={cancelQueue}>{cancelling ? 'กำลังยกเลิก...' : 'ยกเลิกคิว'}</button>}<p style={{ color: '#64748b' }}>หน้านี้อัปเดตอัตโนมัติ</p></>}
    </div></main>;
}
const statusText = { waiting: 'กำลังรอคิว', called: 'ถึงคิวแล้ว กรุณาติดต่อหน้าร้าน', dining: 'เข้ารับบริการแล้ว', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว' };
