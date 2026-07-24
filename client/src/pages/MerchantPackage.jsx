import { useEffect, useState } from 'react';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

const statusText = {
    pending: 'รอส่ง',
    sent: 'ส่งแล้ว',
    failed: 'ส่งไม่สำเร็จ',
    quota_exceeded: 'เกินโควตา'
};

export default function MerchantPackage() {
    const [store, setStore] = useState(null);
    const [usage, setUsage] = useState(null);
    const [logs, setLogs] = useState([]);

    useEffect(() => {
        api.get('/merchant/store').then(({ data }) => setStore(data));
        api.get('/store/notifications/usage').then(({ data }) => setUsage(data));
        api.get('/store/notifications/logs', { params: { limit: 10 } }).then(({ data }) => setLogs(data));
    }, []);

    return (
        <div>
            <MerchantNav />
            <main style={{ maxWidth: 760, margin: '28px auto', padding: '0 18px' }}>
                <h1>การใช้งาน LINE</h1>

                <div className="card" style={{ marginTop: 20 }}>
                    {!store ? 'กำลังโหลด...' : (
                        <>
                            <h2>ระบบคิวใช้ฟรี</h2>
                            <p>สถานะร้าน: {store.isActive ? 'เปิดใช้งาน' : 'ยังไม่เปิดใช้งาน'}</p>
                            <p style={{ color: 'var(--success)', fontWeight: 700 }}>
                                ไม่มีการจำกัดแพ็กเกจหรือโควตา LINE รายเดือน
                            </p>
                        </>
                    )}
                </div>

                {usage && (
                    <div className="card" style={{ marginTop: 16 }}>
                        <h2>ข้อความแจ้งเตือน LINE</h2>
                        <p><strong>{usage.count.toLocaleString()}</strong> ข้อความที่ใช้ในรอบ {usage.period}</p>
                        <p style={{ color: 'var(--success)', fontWeight: 700 }}>ใช้ฟรีและไม่จำกัดสำหรับทุกร้าน</p>
                    </div>
                )}

                <div className="card" style={{ marginTop: 16 }}>
                    <h2>การแจ้งเตือนล่าสุด</h2>
                    {logs.length ? logs.map(log => (
                        <div key={log._id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid #e2e8f0' }}>
                            <span>{log.type}</span>
                            <span>{statusText[log.status] || log.status}{log.retryCount ? ` · retry ${log.retryCount}` : ''}{log.errorCode ? ` · ${log.errorCode}` : ''}</span>
                        </div>
                    )) : <p>เดือนนี้ยังไม่มีการส่งข้อความ</p>}
                </div>
            </main>
        </div>
    );
}
