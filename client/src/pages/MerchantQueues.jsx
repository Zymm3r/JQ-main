import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

const labels = { waiting: 'รอเรียก', called: 'เรียกแล้ว', dining: 'อยู่ในร้าน' };
const colors = { waiting: '#2563eb', called: '#16a34a', dining: '#ca8a04' };

function readPermissions() {
    try { return JSON.parse(localStorage.getItem('account_store') || '{}').membership?.permissions || []; }
    catch { return []; }
}

export default function MerchantQueues({ monitor = false }) {
    const [queues, setQueues] = useState([]);
    const [settings, setSettings] = useState(null);
    const [clockOffset, setClockOffset] = useState(0);
    const [now, setNow] = useState(Date.now());
    const [online, setOnline] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busyQueueId, setBusyQueueId] = useState(null);
    const [scheduleDrafts, setScheduleDrafts] = useState({});
    const canUpdateSettings = readPermissions().includes('settings.update');

    const load = useCallback(async (showError = false) => {
        try {
            const [queueResponse, settingResponse] = await Promise.all([
                api.get('/store/queues'),
                api.get('/store/settings')
            ]);
            setQueues(queueResponse.data);
            if (settingResponse) {
                setSettings(settingResponse.data);
                if (settingResponse.data.serverTime) {
                    setClockOffset(new Date(settingResponse.data.serverTime).getTime() - Date.now());
                }
            }
            setOnline(true);
        } catch (error) {
            setOnline(false);
            if (showError) toast.error(error.response?.data?.error || 'โหลดข้อมูลคิวไม่สำเร็จ');
        }
    }, []);

    useEffect(() => {
        load(true);
        const refreshTimer = setInterval(() => load(false), 5_000);
        return () => clearInterval(refreshTimer);
    }, [load]);

    useEffect(() => {
        const clockTimer = setInterval(() => setNow(Date.now() + clockOffset), 1_000);
        return () => clearInterval(clockTimer);
    }, [clockOffset]);

    const grouped = useMemo(() => ({
        waiting: queues.filter(queue => queue.status === 'waiting'),
        called: queues.filter(queue => queue.status === 'called'),
        dining: queues.filter(queue => queue.status === 'dining')
    }), [queues]);

    const action = async (queue, name) => {
        setBusyQueueId(queue._id);
        try {
            await api.post(`/store/queues/${queue._id}/${name}`);
            await load(false);
        } catch (error) {
            toast.error(error.response?.data?.error || 'อัปเดตคิวไม่สำเร็จ');
        } finally {
            setBusyQueueId(null);
        }
    };

    const schedule = async queue => {
        const value = scheduleDrafts[queue._id];
        if (!value) return toast.error('กรุณาเลือกวันและเวลาเรียกคิว');
        setBusyQueueId(queue._id);
        try {
            await api.put(`/store/queues/${queue._id}/schedule`, { scheduledCallAt: new Date(value).toISOString() });
            toast.success(`ตั้งเวลาเรียก Q${queue.queueNumber} แล้ว`);
            await load(false);
        } catch (error) {
            toast.error(error.response?.data?.error || 'ตั้งเวลาเรียกคิวไม่สำเร็จ');
        } finally {
            setBusyQueueId(null);
        }
    };

    const saveSettings = async event => {
        event.preventDefault();
        setSaving(true);
        try {
            const { data } = await api.put('/store/settings', {
                autoCallEnabled: settings.autoCallEnabled,
                autoCallDelayMinutes: Number(settings.autoCallDelayMinutes),
                seatGracePeriodMinutes: Number(settings.seatGracePeriodMinutes),
                diningTimeLimitMinutes: Number(settings.diningTimeLimitMinutes),
                autoCancelNoShowEnabled: settings.autoCancelNoShowEnabled
            });
            setSettings(data);
            toast.success('บันทึกระบบเรียกคิวอัตโนมัติแล้ว');
            await load(false);
        } catch (error) {
            toast.error(error.response?.data?.error || 'บันทึกการตั้งค่าไม่สำเร็จ');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <MerchantNav />
            <main style={{ maxWidth: monitor ? 1400 : 1180, margin: '26px auto', padding: '0 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                        <h1 style={{ marginBottom: 4 }}>{monitor ? 'จอมอนิเตอร์คิว' : 'จัดการคิวหน้าร้าน'}</h1>
                        <small style={{ color: online ? '#15803d' : '#b91c1c' }}>{online ? '● ข้อมูลล่าสุดเชื่อมต่ออยู่' : '● การเชื่อมต่อขัดข้อง กำลังลองใหม่'}</small>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Summary label="รอเรียก" value={grouped.waiting.length} color="#2563eb" />
                        <Summary label="เรียกแล้ว" value={grouped.called.length} color="#16a34a" />
                        <Summary label="ในร้าน" value={grouped.dining.length} color="#ca8a04" />
                    </div>
                </div>

                {!monitor && canUpdateSettings && settings && (
                    <form className="card" onSubmit={saveSettings} style={{ marginTop: 18, padding: 18 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                            <div>
                                <h2 style={{ fontSize: 19, marginBottom: 4 }}>ระบบเรียกคิวอัตโนมัติ</h2>
                                <p style={{ color: '#64748b', margin: 0 }}>ระบบเรียกตามเวลาที่บันทึกไว้ แต่การรับเข้าร้านและปิดโต๊ะต้องให้พนักงานยืนยันเสมอ</p>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                                <input type="checkbox" checked={Boolean(settings.autoCallEnabled)} onChange={event => setSettings({ ...settings, autoCallEnabled: event.target.checked })} />
                                เปิดใช้งาน
                            </label>
                        </div>
                        <div className="automation-grid">
                            <NumberField label="เรียกหลังรับคิว (นาที)" value={settings.autoCallDelayMinutes} onChange={value => setSettings({ ...settings, autoCallDelayMinutes: value })} />
                            <NumberField label="เวลามาถึงร้านหลังเรียก (นาที)" value={settings.seatGracePeriodMinutes} onChange={value => setSettings({ ...settings, seatGracePeriodMinutes: value })} />
                            <NumberField label="เวลาใช้บริการในร้าน (นาที)" value={settings.diningTimeLimitMinutes} onChange={value => setSettings({ ...settings, diningTimeLimitMinutes: value })} />
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="checkbox" checked={Boolean(settings.autoCancelNoShowEnabled)} onChange={event => setSettings({ ...settings, autoCancelNoShowEnabled: event.target.checked })} />
                                ยกเลิกอัตโนมัติเมื่อไม่มาตามเวลา
                            </label>
                        </div>
                        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}</button>
                    </form>
                )}

                <div className="queue-columns">
                    {['called', 'waiting', 'dining'].map(status => (
                        <section key={status} className="queue-column">
                            <h2 style={{ color: colors[status], fontSize: 19 }}>{labels[status]} ({grouped[status].length})</h2>
                            {grouped[status].map(queue => (
                                <QueueCard
                                    key={queue._id}
                                    queue={queue}
                                    now={now}
                                    monitor={monitor}
                                    busy={busyQueueId === queue._id}
                                    scheduleValue={scheduleDrafts[queue._id] || ''}
                                    onScheduleValue={value => setScheduleDrafts(current => ({ ...current, [queue._id]: value }))}
                                    onSchedule={() => schedule(queue)}
                                    onAction={name => action(queue, name)}
                                />
                            ))}
                            {!grouped[status].length && <div className="card" style={{ color: '#64748b' }}>ไม่มีคิวในสถานะนี้</div>}
                        </section>
                    ))}
                </div>
            </main>
            <style>{`
                .automation-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:14px; margin:16px 0; align-items:end; }
                .queue-columns { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:16px; margin-top:20px; }
                .queue-column { background:#f8fafc; border-radius:14px; padding:14px; min-width:0; }
                .queue-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:12px; }
                @media (max-width:900px) { .queue-columns { grid-template-columns:1fr; } }
            `}</style>
        </div>
    );
}

function QueueCard({ queue, now, monitor, busy, scheduleValue, onScheduleValue, onSchedule, onAction }) {
    const deadline = queue.status === 'waiting' ? queue.scheduledCallAt : queue.status === 'called' ? queue.seatDeadlineAt : queue.diningDeadlineAt;
    const remaining = deadline ? new Date(deadline).getTime() - now : null;
    const overdue = remaining !== null && remaining <= 0;
    return (
        <article className="card" style={{ borderTop: `5px solid ${colors[queue.status]}`, marginBottom: 12, opacity: busy ? 0.65 : 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <strong style={{ fontSize: monitor ? 42 : 30 }}>Q{queue.queueNumber}</strong>
                <span style={{ color: colors[queue.status], fontWeight: 700 }}>{labels[queue.status]}</span>
            </div>
            <h3 style={{ marginBottom: 4 }}>{queue.customerName}</h3>
            <p style={{ margin: '4px 0' }}>{queue.pax} คน · {formatTimeSlot(queue.time_slot || queue.timeSlot)}</p>
            <small style={{ color: '#64748b' }}>แหล่งที่มา: {queue.source || 'main'}</small>
            {deadline && (
                <div style={{ marginTop: 10, padding: 9, borderRadius: 8, background: overdue ? '#fee2e2' : '#eff6ff', color: overdue ? '#b91c1c' : '#1d4ed8', fontWeight: 700 }}>
                    {deadlineLabel(queue.status)}: {overdue ? `เกิน ${formatDuration(-remaining)}` : `เหลือ ${formatDuration(remaining)}`}
                    <div style={{ fontSize: 12, fontWeight: 400 }}>{formatDateTime(deadline)}</div>
                </div>
            )}
            {!monitor && queue.status === 'waiting' && (
                <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 13, color: '#475569' }}>กำหนดเวลาเรียกคิวนี้</label>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <input type="datetime-local" value={scheduleValue} onChange={event => onScheduleValue(event.target.value)} style={{ minWidth: 0, flex: 1 }} />
                        <button className="btn btn-secondary" disabled={busy} onClick={onSchedule}>ตั้งเวลา</button>
                    </div>
                </div>
            )}
            {!monitor && (
                <div className="queue-actions">
                    {queue.status === 'waiting' && <button className="btn btn-primary" disabled={busy} onClick={() => onAction('call')}>เรียกทันที</button>}
                    {['waiting', 'called'].includes(queue.status) && <button className="btn btn-success" disabled={busy} onClick={() => onAction('seat')}>รับเข้าร้าน</button>}
                    {queue.status === 'dining' && <button className="btn btn-primary" disabled={busy} onClick={() => onAction('complete')}>ปิดโต๊ะ</button>}
                    {['waiting', 'called'].includes(queue.status) && <button className="btn btn-secondary" disabled={busy} onClick={() => onAction('cancel')}>ยกเลิก</button>}
                </div>
            )}
        </article>
    );
}

function NumberField({ label, value, onChange }) {
    return <label style={{ display: 'grid', gap: 5 }}>{label}<input type="number" min="1" max="1440" required value={value ?? ''} onChange={event => onChange(event.target.value)} /></label>;
}

function Summary({ label, value, color }) {
    return <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px' }}><strong style={{ color }}>{value}</strong> <small>{label}</small></div>;
}

function deadlineLabel(status) {
    if (status === 'waiting') return 'เวลาเรียก';
    if (status === 'called') return 'เวลารับเข้าร้าน';
    return 'เวลาใช้บริการ';
}

function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function formatDateTime(value) {
    return new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
}

function formatTimeSlot(value) {
    if (!value || value === 'now') return 'คิวปกติ (ตอนนี้)';
    return `เวลา ${value}`;
}
