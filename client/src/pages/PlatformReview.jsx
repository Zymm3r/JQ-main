import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { clearAccountSession, getAccountToken } from '../utils/account';

export default function PlatformReview() {
    const navigate = useNavigate();
    const [overview, setOverview] = useState(null);
    const [stores, setStores] = useState([]);
    const [revenue, setRevenue] = useState(null);
    const [errors, setErrors] = useState([]);
    const [audits, setAudits] = useState([]);
    const [status, setStatus] = useState('');

    const loadStores = () => api.get('/platform/stores', { params: status ? { status } : {} }).then(({ data }) => setStores(data));

    useEffect(() => {
        if (!getAccountToken()) { navigate('/login'); return; }
        const onError = error => {
            if ([401, 403].includes(error.response?.status)) { clearAccountSession(); navigate('/login'); }
            else toast.error(error.response?.data?.error || 'โหลดข้อมูลแพลตฟอร์มไม่สำเร็จ');
        };
        api.get('/platform/overview').then(({ data }) => setOverview(data)).catch(onError);
        api.get('/platform/stores').then(({ data }) => setStores(data)).catch(onError);
        api.get('/platform/revenue').then(({ data }) => setRevenue(data)).catch(() => {});
        api.get('/platform/errors').then(({ data }) => setErrors(data)).catch(() => {});
        api.get('/platform/audit').then(({ data }) => setAudits(data)).catch(() => {});
    }, [navigate]);

    const decide = async (storeId, action) => {
        const message = action === 'approve' ? null : window.prompt(action === 'request_more_info' ? 'รายละเอียดที่ต้องการเพิ่ม' : 'เหตุผล');
        if (action !== 'approve' && !message) return;
        try {
            await api.post(`/platform/stores/${storeId}/decision`, { action, message });
            toast.success('อัปเดตผลตรวจร้านแล้ว');
            loadStores();
        } catch (error) {
            toast.error(error.response?.data?.error || 'อัปเดตผลตรวจร้านไม่สำเร็จ');
        }
    };

    const impersonate = async store => {
        const reason = window.prompt('เหตุผลสำหรับ audit อย่างน้อย 10 ตัวอักษร');
        if (!reason) return;
        try {
            const { data } = await api.post(`/platform/stores/${store.storeId}/impersonate`, { reason });
            localStorage.setItem('platform_account_token', getAccountToken());
            localStorage.setItem('account_token', data.token);
            localStorage.setItem('account_store', JSON.stringify({ storeId: store.storeId, name: store.name, membership: { role: 'platform_impersonation' } }));
            localStorage.removeItem('active_branch_id');
            navigate('/store/queues');
        } catch (error) {
            toast.error(error.response?.data?.error || 'เข้าใช้งานแทนร้านไม่สำเร็จ');
        }
    };

    return (
        <main style={{ maxWidth: 1200, margin: '22px auto', padding: '0 18px' }}>
            <header className="card" style={{ textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 15 }}>
                <div><h1>ผู้ดูแลแพลตฟอร์ม</h1><p>ตรวจสอบร้านค้า ติดตามระบบ ดู audit และช่วยเหลือร้านค้า</p></div>
                <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => { clearAccountSession(); navigate('/login'); }}>ออกจากระบบ</button>
            </header>

            {overview && (
                <section className="grid-2" style={{ marginTop: 18 }}>
                    <Metric label="ร้านทั้งหมด" value={overview.stores} />
                    <Metric label="ร้านที่เปิดใช้งาน" value={overview.activeStores ?? overview.activeSubscriptions} />
                    <Metric label="คิวทั้งหมด" value={overview.totalQueues} />
                    <Metric label={`ข้อความ LINE · ${overview.period}`} value={overview.lineMessages} />
                </section>
            )}

            <section className="card" style={{ textAlign: 'left', marginTop: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                    <h2>ร้านค้า</h2>
                    <select
                        value={status}
                        onChange={event => {
                            setStatus(event.target.value);
                            api.get('/platform/stores', { params: event.target.value ? { status: event.target.value } : {} }).then(({ data }) => setStores(data));
                        }}
                        style={{ ...inputStyle, maxWidth: 240 }}
                    >
                        <option value="">ทุกสถานะ</option>
                        {['pending_verification', 'draft', 'verified', 'rejected', 'suspended'].map(value => <option key={value}>{value}</option>)}
                    </select>
                </div>
                <div style={{ overflowX: 'auto', marginTop: 14 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr><Th>ร้าน</Th><Th>สถานะ</Th><Th>บริการ</Th><Th>การใช้งาน</Th><Th>คำสั่ง</Th></tr></thead>
                        <tbody>{stores.map(store => (
                            <tr key={store.storeId}>
                                <Td><strong>{store.name || 'ยังไม่ตั้งชื่อร้าน'}</strong><br /><small>{store.storeId}<br />{store.ownerId?.email}</small></Td>
                                <Td>{store.verificationStatus}</Td>
                                <Td>ฟรี<br /><small>ไม่มี subscription gate</small></Td>
                                <Td>{store.queueCount} คิว<br />LINE {store.lineMessageCount} ข้อความ</Td>
                                <Td><div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                    {store.verificationStatus === 'pending_verification' && <Action onClick={() => decide(store.storeId, 'approve')}>อนุมัติ</Action>}
                                    <Action onClick={() => decide(store.storeId, 'suspend')}>ระงับ</Action>
                                    <Action onClick={() => impersonate(store)}>เข้าแทนร้าน</Action>
                                </div></Td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            </section>

            <section className="grid-2" style={{ marginTop: 18, alignItems: 'start' }}>
                <div className="card" style={{ textAlign: 'left' }}>
                    <h2>รูปแบบบริการ</h2>
                    <p>ระบบคิวและข้อความ LINE เปิดใช้ฟรีแบบไม่จำกัด ผู้ดูแลยังติดตามการใช้งานและ error เพื่อดูแลระบบ</p>
                </div>
                <div className="card" style={{ textAlign: 'left' }}>
                    <h2>รายงานรายได้</h2>
                    {revenue ? (
                        <>
                            <h3 style={{ marginTop: 14 }}>{revenue.monthlyRecurringRevenue.toLocaleString()} {revenue.currency} MRR</h3>
                            {revenue.byPackage.map(item => <div key={item.code} style={rowStyle}><span>{item.code} · {item.stores} ร้าน</span><strong>{item.monthlyRevenue.toLocaleString()} THB</strong></div>)}
                        </>
                    ) : <p>ต้องใช้สิทธิ์ Platform Admin เพื่อดูรายได้</p>}
                </div>
                <div className="card" style={{ textAlign: 'left' }}>
                    <h2>บันทึกข้อผิดพลาด</h2>
                    {errors.slice(0, 20).map(item => <div key={item._id} style={rowStyle}><span>{item.storeId}<br /><small>{item.type}</small></span><strong>{item.errorCode || item.status}</strong></div>)}
                    {!errors.length && <p>ยังไม่มี error</p>}
                </div>
                <div className="card" style={{ textAlign: 'left' }}>
                    <h2>Audit log</h2>
                    {audits.slice(0, 20).map(item => <div key={item._id} style={rowStyle}><span>{item.action}<br /><small>{item.actorUserId?.email || item.actorRole} · {item.storeId || 'platform'}</small></span><small>{new Date(item.createdAt).toLocaleString()}</small></div>)}
                    {!audits.length && <p>ยังไม่มี audit event</p>}
                </div>
            </section>
        </main>
    );
}

function Metric({ label, value }) { return <div className="card" style={{ textAlign: 'left' }}><small>{label}</small><h2 style={{ marginTop: 5 }}>{Number(value || 0).toLocaleString()}</h2></div>; }
function Action({ children, onClick }) { return <button className="btn btn-secondary" style={{ width: 'auto', padding: '6px 9px' }} onClick={onClick}>{children}</button>; }
function Th({ children }) { return <th style={{ textAlign: 'left', padding: 9, borderBottom: '2px solid #e2e8f0' }}>{children}</th>; }
function Td({ children }) { return <td style={{ padding: 9, verticalAlign: 'top', borderBottom: '1px solid #e2e8f0' }}>{children}</td>; }

const inputStyle = { width: '100%', padding: 10, border: '2px solid #e2e8f0', borderRadius: 10 };
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid #e2e8f0' };
