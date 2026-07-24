import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { saveAccountSession } from '../utils/account';

const errorMessages = {
    'Valid email is required': 'กรุณากรอกอีเมลให้ถูกต้อง',
    'Password must contain at least 10 characters': 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร',
    'Name is required': 'กรุณากรอกชื่อเจ้าของร้าน',
    'Phone is required': 'กรุณากรอกเบอร์โทรศัพท์',
    'Terms of service must be accepted': 'กรุณายอมรับข้อกำหนดการให้บริการ',
    'Email is already registered': 'อีเมลนี้ถูกสมัครไว้แล้ว',
    'Too many attempts. Please try again later.': 'พยายามหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง',
    'Registration failed': 'สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
};

function thaiError(error, fallback = 'สมัครสมาชิกไม่สำเร็จ') {
    const message = error.response?.data?.error;
    return errorMessages[message] || message || fallback;
}

export default function Register() {
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: '', password: '', name: '', phone: '', acceptedTerms: false });
    const [submitting, setSubmitting] = useState(false);

    const submit = async event => {
        event.preventDefault();
        setSubmitting(true);
        try {
            const { data } = await api.post('/auth/register', form);
            saveAccountSession(data);
            toast.success('สร้างบัญชีสำเร็จ');
            navigate('/onboarding');
        } catch (error) {
            toast.error(thaiError(error));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="card" style={{ maxWidth: 520, margin: '30px auto', textAlign: 'left' }}>
            <h2>สมัครบัญชีร้านค้า</h2>
            <p style={{ color: 'var(--text-light)', margin: '8px 0 24px' }}>
                สร้างบัญชีเจ้าของร้านก่อน จากนั้นยืนยันอีเมลและส่งข้อมูลร้านให้แพลตฟอร์มตรวจสอบ
            </p>
            <form onSubmit={submit}>
                <Field label="ชื่อเจ้าของร้าน" value={form.name} onChange={name => setForm({ ...form, name })} />
                <Field label="อีเมล" type="email" value={form.email} onChange={email => setForm({ ...form, email })} />
                <Field label="เบอร์โทรศัพท์" value={form.phone} onChange={phone => setForm({ ...form, phone })} />
                <Field label="รหัสผ่าน (อย่างน้อย 10 ตัวอักษร)" type="password" value={form.password} onChange={password => setForm({ ...form, password })} minLength={10} />
                <label style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={form.acceptedTerms} onChange={event => setForm({ ...form, acceptedTerms: event.target.checked })} required />
                    <span>ฉันยอมรับข้อกำหนดการให้บริการและนโยบายความเป็นส่วนตัว</span>
                </label>
                <button className="btn btn-primary" disabled={submitting}>{submitting ? 'กำลังสร้างบัญชี...' : 'สร้างบัญชี'}</button>
            </form>
            <p style={{ textAlign: 'center', marginTop: 20 }}>
                มีบัญชีแล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
            </p>
        </div>
    );
}

function Field({ label, type = 'text', value, onChange, minLength }) {
    return (
        <div className="input-group">
            <label>{label}</label>
            <input type={type} value={value} onChange={event => onChange(event.target.value)} minLength={minLength} required />
        </div>
    );
}
