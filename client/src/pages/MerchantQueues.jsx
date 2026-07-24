import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

export default function MerchantQueues({ monitor = false }) {
    const [queues, setQueues] = useState([]);

    const load = () => api.get('/store/queues')
        .then(({ data }) => setQueues(data))
        .catch(error => toast.error(error.response?.data?.error || 'โหลดคิวไม่สำเร็จ'));

    useEffect(() => {
        load();
        const timer = setInterval(load, 10000);
        return () => clearInterval(timer);
    }, []);

    const action = async (queue, name) => {
        try {
            await api.post(`/store/queues/${queue._id}/${name}`);
            await load();
        } catch (error) {
            toast.error(error.response?.data?.error || 'อัปเดตคิวไม่สำเร็จ');
        }
    };

    return (
        <div>
            <MerchantNav />
            <main style={{ maxWidth: monitor ? 1400 : 1050, margin: '26px auto', padding: '0 18px' }}>
                <h1>{monitor ? 'จอมอนิเตอร์คิว' : 'คิวของร้าน'}</h1>
                <div style={{ display: 'grid', gridTemplateColumns: monitor ? 'repeat(auto-fit,minmax(260px,1fr))' : 'repeat(auto-fit,minmax(300px,1fr))', gap: 16, marginTop: 20 }}>
                    {queues.map(queue => (
                        <article className="card" key={queue._id} style={{ borderTop: `5px solid ${colors[queue.status] || '#64748b'}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <strong style={{ fontSize: monitor ? 42 : 28 }}>Q{queue.queueNumber}</strong>
                                <span>{labels[queue.status] || queue.status}</span>
                            </div>
                            <h3>{queue.customerName}</h3>
                            <p>{queue.pax} คน · {formatTimeSlot(queue.time_slot || queue.timeSlot)}</p>
                            <small>แหล่งที่มา: {queue.source}</small>
                            {!monitor && (
                                <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                                    {queue.status === 'waiting' && <button className="btn btn-primary" onClick={() => action(queue, 'call')}>เรียกคิว</button>}
                                    {['waiting', 'called'].includes(queue.status) && <button className="btn btn-success" onClick={() => action(queue, 'seat')}>รับเข้าร้าน</button>}
                                    {queue.status === 'dining' && <button className="btn btn-primary" onClick={() => action(queue, 'complete')}>เสร็จสิ้น</button>}
                                    {['waiting', 'called'].includes(queue.status) && <button className="btn btn-secondary" onClick={() => action(queue, 'cancel')}>ยกเลิก</button>}
                                </div>
                            )}
                        </article>
                    ))}
                    {!queues.length && <div className="card">ยังไม่มีคิวที่กำลังใช้งาน</div>}
                </div>
            </main>
        </div>
    );
}

const colors = { waiting: '#2563eb', called: '#16a34a', dining: '#ca8a04', completed: '#64748b', cancelled: '#dc2626' };
const labels = { waiting: 'รอคิว', called: 'เรียกแล้ว', dining: 'กำลังใช้บริการ', completed: 'เสร็จสิ้น', cancelled: 'ยกเลิกแล้ว' };

function formatTimeSlot(value) {
    if (!value || value === 'now') return 'คิวปกติ (Now)';
    return `เวลา ${value}`;
}
