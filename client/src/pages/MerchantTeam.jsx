import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api';
import MerchantNav from '../components/MerchantNav';

const roles = ['manager', 'staff', 'viewer'];

export default function MerchantTeam() {
    const [members, setMembers] = useState([]);
    const [branches, setBranches] = useState([]);
    const [member, setMember] = useState({ email: '', password: '', name: '', phone: '', role: 'staff' });
    const [branch, setBranch] = useState({ name: '', slug: '', address: '', phone: '', timezone: 'Asia/Bangkok' });
    const activeBranchId = localStorage.getItem('active_branch_id') || 'default';

    const load = async () => {
        try {
            const [memberResponse, branchResponse] = await Promise.all([api.get('/store/members'), api.get('/store/branches')]);
            setMembers(memberResponse.data);
            setBranches(branchResponse.data);
        } catch (error) {
            toast.error(error.response?.data?.error || 'โหลดข้อมูลพนักงานและสาขาไม่สำเร็จ');
        }
    };
    useEffect(() => {
        Promise.all([api.get('/store/members'), api.get('/store/branches')])
            .then(([memberResponse, branchResponse]) => {
                setMembers(memberResponse.data);
                setBranches(branchResponse.data);
            })
            .catch(error => toast.error(error.response?.data?.error || 'โหลดข้อมูลพนักงานและสาขาไม่สำเร็จ'));
    }, []);

    const addMember = async event => {
        event.preventDefault();
        try {
            await api.post('/store/members', member);
            setMember({ email: '', password: '', name: '', phone: '', role: 'staff' });
            toast.success('เพิ่มบัญชีพนักงานแล้ว');
            load();
        } catch (error) { toast.error(error.response?.data?.error || 'เพิ่มพนักงานไม่สำเร็จ'); }
    };

    const addBranch = async event => {
        event.preventDefault();
        try {
            await api.post('/store/branches', branch);
            setBranch({ name: '', slug: '', address: '', phone: '', timezone: 'Asia/Bangkok' });
            toast.success('เพิ่มสาขาแล้ว');
            load();
        } catch (error) { toast.error(error.response?.data?.error || 'เพิ่มสาขาไม่สำเร็จ'); }
    };

    const selectBranch = branchId => {
        localStorage.setItem('active_branch_id', branchId);
        toast.success('เปลี่ยนสาขาที่กำลังจัดการแล้ว');
        window.location.reload();
    };

    return <div><MerchantNav /><main style={{ maxWidth: 1050, margin: '28px auto', padding: '0 18px' }}>
        <h1>พนักงานและสาขา</h1>
        <div className="grid-2" style={{ marginTop: 20, alignItems: 'start' }}>
            <section className="card" style={{ textAlign: 'left' }}>
                <h2>บัญชีพนักงาน</h2>
                <form onSubmit={addMember} style={{ marginTop: 16 }}>
                    <Field label="อีเมล"><input type="email" value={member.email} onChange={event => setMember({ ...member, email: event.target.value })} required /></Field>
                    <Field label="รหัสผ่านเริ่มต้น (อย่างน้อย 10 ตัว)"><input type="password" minLength="10" value={member.password} onChange={event => setMember({ ...member, password: event.target.value })} required /></Field>
                    <Field label="ชื่อ"><input value={member.name} onChange={event => setMember({ ...member, name: event.target.value })} required /></Field>
                    <Field label="โทรศัพท์"><input value={member.phone} onChange={event => setMember({ ...member, phone: event.target.value })} required /></Field>
                    <Field label="บทบาท"><select value={member.role} onChange={event => setMember({ ...member, role: event.target.value })}>{roles.map(role => <option key={role}>{role}</option>)}</select></Field>
                    <button className="btn btn-primary">สร้างบัญชีพนักงาน</button>
                </form>
                <div style={{ marginTop: 20 }}>{members.map(item => <div key={item.id} style={rowStyle}><div><strong>{item.user.name}</strong><br /><small>{item.user.email}</small></div><span>{item.role} · {item.status}</span></div>)}</div>
            </section>
            <section className="card" style={{ textAlign: 'left' }}>
                <h2>สาขา</h2>
                <form onSubmit={addBranch} style={{ marginTop: 16 }}>
                    <Field label="ชื่อสาขา"><input value={branch.name} onChange={event => setBranch({ ...branch, name: event.target.value })} required /></Field>
                    <Field label="Slug"><input pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={branch.slug} onChange={event => setBranch({ ...branch, slug: event.target.value.toLowerCase() })} required /></Field>
                    <Field label="ที่อยู่"><input value={branch.address} onChange={event => setBranch({ ...branch, address: event.target.value })} /></Field>
                    <Field label="โทรศัพท์"><input value={branch.phone} onChange={event => setBranch({ ...branch, phone: event.target.value })} /></Field>
                    <button className="btn btn-primary">เพิ่มสาขา</button>
                </form>
                <div style={{ marginTop: 20 }}>{branches.map(item => <div key={item.branchId} style={rowStyle}><div><strong>{item.name}</strong><br /><small>{item.slug} · {item.timezone}</small></div><button className="btn btn-secondary" style={{ width: 'auto' }} disabled={activeBranchId === item.branchId} onClick={() => selectBranch(item.branchId)}>{activeBranchId === item.branchId ? 'กำลังใช้งาน' : 'เลือกสาขา'}</button></div>)}</div>
            </section>
        </div>
    </main></div>;
}

function Field({ label, children }) { return <div className="input-group"><label>{label}</label>{children}</div>; }
const rowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #e2e8f0' };
