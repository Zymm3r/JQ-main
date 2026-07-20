import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import toast from 'react-hot-toast';
import { Copy, Download, FileDown, Plus, Trash2 } from 'lucide-react';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

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
            toast.error(error.response?.data?.error || 'ไม่สามารถโหลด QR Code ได้');
        }
    };
    useEffect(() => { load(); }, []);
    useEffect(() => {
        if (selected && canvasRef.current) QRCode.toCanvas(canvasRef.current, selected.liffUrl, { width: 300, margin: 2, errorCorrectionLevel: 'H' });
    }, [selected]);

    const posterCanvas = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1240; canvas.height = 1754;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#172554'; ctx.textAlign = 'center'; ctx.font = '700 64px sans-serif';
        ctx.fillText(data.store.name || 'Queue', 620, 180);
        ctx.font = '500 38px sans-serif'; ctx.fillText(selected.name, 620, 255);
        const qr = document.createElement('canvas');
        await QRCode.toCanvas(qr, selected.liffUrl, { width: 820, margin: 3, errorCorrectionLevel: 'H' });
        ctx.drawImage(qr, 210, 350, 820, 820);
        ctx.font = '600 42px sans-serif'; ctx.fillText('Scan with LINE to join the queue', 620, 1300);
        ctx.fillStyle = '#475569'; ctx.font = '28px sans-serif'; ctx.fillText(selected.liffUrl, 620, 1390, 1040);
        return canvas;
    };
    const downloadPng = async () => {
        const canvas = await posterCanvas();
        const link = document.createElement('a'); link.download = `${selected.key}-queue-qr.png`; link.href = canvas.toDataURL('image/png'); link.click();
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
        toast.success('คัดลอก LIFF link แล้ว');
    };
    const create = async event => {
        event.preventDefault();
        try {
            await api.post('/store/qr-sources', form);
            setForm({ name: '', key: '', kind: 'point', branchName: '' });
            await load(); toast.success('สร้าง QR source แล้ว');
        } catch (error) { toast.error(error.response?.data?.error || 'สร้าง QR source ไม่สำเร็จ'); }
    };
    const remove = async source => {
        if (!confirm(`ลบ ${source.name}?`)) return;
        await api.delete(`/store/qr-sources/${source.id}`); await load();
    };

    return <div><MerchantNav /><main style={{ maxWidth: 1100, margin: '28px auto', padding: '0 18px' }}>
        <h1>QR Code ประจำร้าน</h1>
        <p style={{ color: '#64748b' }}>สร้าง QR หลัก แยกสาขา จุดติดตั้ง หรือกิจกรรม พร้อมเก็บสถิติแหล่งที่มาของการสแกน</p>
        {!data ? <p>กำลังโหลด...</p> : <div className="grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
            <section className="card" style={{ textAlign: 'center' }}>
                <h2>{data.store.name}</h2><p>{selected?.name}</p>
                <canvas ref={canvasRef} style={{ maxWidth: '100%' }} />
                <div style={{ wordBreak: 'break-all', color: '#64748b', fontSize: 13, marginBottom: 16 }}>{selected?.liffUrl}</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={downloadPng}><Download size={16} /> ดาวน์โหลด PNG</button>
                    <button className="btn btn-secondary" onClick={downloadPdf}><FileDown size={16} /> ดาวน์โหลด PDF</button>
                    <button className="btn btn-secondary" onClick={copyLink}><Copy size={16} /> Copy LIFF link</button>
                </div>
            </section>
            <section>
                <div className="card"><h3>QR ของร้าน</h3>{data.sources.map(source => <div key={source.id} onClick={() => setSelected(source)} style={{ padding: 12, marginTop: 8, borderRadius: 10, cursor: 'pointer', background: selected?.id === source.id ? '#dbeafe' : '#f8fafc', display: 'flex', justifyContent: 'space-between' }}>
                    <div><strong>{source.name}</strong><div style={{ fontSize: 12, color: '#64748b' }}>{source.kind} · scan {source.scanCount} · reserve {source.reservationCount}</div></div>
                    {source.kind !== 'main' && <button onClick={event => { event.stopPropagation(); remove(source); }} style={{ border: 0, background: 'transparent', color: '#dc2626' }}><Trash2 size={17} /></button>}
                </div>)}</div>
                <form className="card" style={{ marginTop: 16 }} onSubmit={create}><h3><Plus size={18} /> สร้าง QR แยก</h3>
                    <div className="input-group"><label>ชื่อจุด / สาขา</label><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                    <div className="input-group"><label>Source key</label><input required placeholder="front-desk" value={form.key} onChange={e => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></div>
                    <div className="input-group"><label>ประเภท</label><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="point">จุดติดตั้ง</option><option value="branch">สาขา</option><option value="event">กิจกรรม</option></select></div>
                    {form.kind === 'branch' && <div className="input-group"><label>ชื่อสาขา</label><input value={form.branchName} onChange={e => setForm({ ...form, branchName: e.target.value })} /></div>}
                    <button className="btn btn-primary">สร้าง QR</button>
                </form>
            </section>
        </div>}
    </main></div>;
}
