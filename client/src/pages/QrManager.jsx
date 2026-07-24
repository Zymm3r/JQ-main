import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { Copy, Download, FileDown, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

const kindLabels = {
    main: 'QR หลักของร้าน',
    point: 'จุดติดตั้ง',
    branch: 'สาขา',
    event: 'กิจกรรม'
};

export default function QrManager() {
    const [data, setData] = useState(null);
    const [selected, setSelected] = useState(null);
    const [form, setForm] = useState({ name: '', key: '', kind: 'point', branchName: '' });
    const canvasRef = useRef(null);

    const load = async () => {
        try {
            const response = await api.get('/store/qr');
            setData(response.data);
            setSelected(current => response.data.sources.find(item => item.id === current?.id) || response.data.sources[0]);
        } catch (error) {
            toast.error(error.response?.data?.error || 'โหลด QR Code ไม่สำเร็จ');
        }
    };

    useEffect(() => { load(); }, []);
    useEffect(() => {
        if (selected && canvasRef.current) {
            QRCode.toCanvas(canvasRef.current, selected.liffUrl, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
        }
    }, [selected]);

    const posterCanvas = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1240;
        canvas.height = 1754;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#172554';
        ctx.textAlign = 'center';
        ctx.font = '700 64px sans-serif';
        ctx.fillText(data.store.name || 'ร้านค้า', 620, 180);
        ctx.font = '500 38px sans-serif';
        ctx.fillText(selected.name, 620, 255);

        const qr = document.createElement('canvas');
        await QRCode.toCanvas(qr, selected.liffUrl, { width: 820, margin: 3, errorCorrectionLevel: 'H' });
        ctx.drawImage(qr, 210, 350, 820, 820);

        ctx.font = '600 42px sans-serif';
        ctx.fillText('สแกนด้วย LINE เพื่อรับคิว', 620, 1300);
        ctx.fillStyle = '#475569';
        ctx.font = '28px sans-serif';
        ctx.fillText(selected.liffUrl, 620, 1390, 1040);
        ctx.font = '24px sans-serif';
        ctx.fillText('ระบบจะแจ้งเตือนคิวผ่าน LINE Official Account กลางของแพลตฟอร์ม', 620, 1450, 1040);
        return canvas;
    };

    const downloadPng = async () => {
        const canvas = await posterCanvas();
        const link = document.createElement('a');
        link.download = `${selected.key}-queue-qr.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    };

    const downloadPdf = async () => {
        const { jsPDF } = await import('jspdf');
        const canvas = await posterCanvas();
        const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297);
        pdf.save(`${selected.key}-queue-qr.pdf`);
    };

    const copyLink = async () => {
        await navigator.clipboard.writeText(selected.liffUrl);
        toast.success('คัดลอกลิงก์ LIFF แล้ว');
    };

    const create = async event => {
        event.preventDefault();
        try {
            await api.post('/store/qr-sources', form);
            setForm({ name: '', key: '', kind: 'point', branchName: '' });
            await load();
            toast.success('สร้าง QR แล้ว');
        } catch (error) {
            toast.error(error.response?.data?.error || 'สร้าง QR ไม่สำเร็จ');
        }
    };

    const remove = async source => {
        if (!confirm(`ลบ ${source.name}?`)) return;
        await api.delete(`/store/qr-sources/${source.id}`);
        await load();
    };

    return (
        <div>
            <MerchantNav />
            <main style={{ maxWidth: 1100, margin: '28px auto', padding: '0 18px' }}>
                <h1>QR Code ของร้าน</h1>
                <p style={{ color: '#64748b', lineHeight: 1.6, marginTop: 8 }}>
                    สร้าง QR Code เฉพาะร้านนี้ ลูกค้าสแกนด้วย LINE เพื่อเปิดหน้า LIFF รับคิว
                    และรับข้อความแจ้งเตือนผ่าน LINE Official Account กลางของแพลตฟอร์ม
                </p>

                {!data ? <p style={{ marginTop: 24 }}>กำลังโหลด...</p> : (
                    <div className="grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
                        <section className="card" style={{ textAlign: 'center' }}>
                            <h2>{data.store.name}</h2>
                            <p style={{ color: '#64748b', marginTop: 4 }}>{selected?.name}</p>
                            <canvas ref={canvasRef} style={{ maxWidth: '100%', marginTop: 12 }} />
                            <div style={{ wordBreak: 'break-all', color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                                {selected?.liffUrl}
                            </div>
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                                <button className="btn btn-primary" onClick={downloadPng} style={{ width: 'auto' }}><Download size={16} /> ดาวน์โหลด PNG</button>
                                <button className="btn btn-secondary" onClick={downloadPdf} style={{ width: 'auto' }}><FileDown size={16} /> ดาวน์โหลด PDF</button>
                                <button className="btn btn-secondary" onClick={copyLink} style={{ width: 'auto' }}><Copy size={16} /> คัดลอกลิงก์ LIFF</button>
                            </div>
                        </section>

                        <section>
                            <div className="card">
                                <h3>รายการ QR</h3>
                                {data.sources.map(source => (
                                    <div
                                        key={source.id}
                                        onClick={() => setSelected(source)}
                                        style={{
                                            padding: 12,
                                            marginTop: 8,
                                            borderRadius: 10,
                                            cursor: 'pointer',
                                            background: selected?.id === source.id ? '#dbeafe' : '#f8fafc',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            gap: 12
                                        }}
                                    >
                                        <div>
                                            <strong>{source.name}</strong>
                                            <div style={{ fontSize: 12, color: '#64748b' }}>
                                                {kindLabels[source.kind] || source.kind} · สแกน {source.scanCount} · รับคิว {source.reservationCount}
                                            </div>
                                        </div>
                                        {source.kind !== 'main' && (
                                            <button
                                                onClick={event => { event.stopPropagation(); remove(source); }}
                                                style={{ border: 0, background: 'transparent', color: '#dc2626' }}
                                                aria-label={`ลบ ${source.name}`}
                                            >
                                                <Trash2 size={17} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <form className="card" style={{ marginTop: 16 }} onSubmit={create}>
                                <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Plus size={18} /> สร้าง QR เพิ่ม</h3>
                                <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
                                    ใช้ QR เพิ่มสำหรับสาขา จุดหน้าร้าน โต๊ะประชาสัมพันธ์ หรือแคมเปญ
                                </p>
                                <div className="input-group" style={{ marginTop: 16 }}>
                                    <label>ชื่อที่แสดง</label>
                                    <input
                                        required
                                        placeholder="หน้าร้าน"
                                        value={form.name}
                                        onChange={e => setForm({ ...form, name: e.target.value })}
                                    />
                                </div>
                                <div className="input-group">
                                    <label>รหัสแหล่งที่มา</label>
                                    <input
                                        required
                                        placeholder="front-desk"
                                        value={form.key}
                                        onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                                    />
                                </div>
                                <div className="input-group">
                                    <label>ประเภท</label>
                                    <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
                                        <option value="point">จุดติดตั้ง</option>
                                        <option value="branch">สาขา</option>
                                        <option value="event">กิจกรรม</option>
                                    </select>
                                </div>
                                {form.kind === 'branch' && (
                                    <div className="input-group">
                                        <label>ชื่อสาขา</label>
                                        <input value={form.branchName} onChange={e => setForm({ ...form, branchName: e.target.value })} />
                                    </div>
                                )}
                                <button className="btn btn-primary">สร้าง QR</button>
                            </form>
                        </section>
                    </div>
                )}
            </main>
        </div>
    );
}
