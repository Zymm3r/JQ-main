import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { saveAccountSession } from '../utils/account';

const errorMessages = {
    'Invalid email or password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'Account is suspended': 'บัญชีนี้ถูกระงับการใช้งาน',
    'No active store membership': 'บัญชีนี้ยังไม่มีสิทธิ์ใช้งานร้านค้า',
    'Too many attempts. Please try again later.': 'พยายามหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง',
    'Login failed': 'เข้าสู่ระบบไม่สำเร็จ'
};

function thaiError(error, fallback = 'เข้าสู่ระบบไม่สำเร็จ') {
    const message = error.response?.data?.error;
    return errorMessages[message] || message || fallback;
}

export default function Login() {
    const navigate = useNavigate();
    const [form, setForm] = useState({ email: '', password: '' });
    const [submitting, setSubmitting] = useState(false);

    const submit = async event => {
        event.preventDefault();
        setSubmitting(true);
        try {
            const { data } = await api.post('/auth/login', form);
            saveAccountSession(data);
            if (['PLATFORM_ADMIN', 'PLATFORM_SUPPORT', 'platform_admin'].includes(data.user.role)) navigate('/platform-admin');
            else if (!data.user.emailVerified) navigate('/onboarding');
            else navigate('/store/setup');
        } catch (error) {
            toast.error(thaiError(error));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="card" style={{ maxWidth: 460, margin: '50px auto', textAlign: 'left' }}>
            <h2>เข้าสู่ระบบร้านค้า</h2>
            <p style={{ color: 'var(--text-light)', marginTop: 8 }}>
                เข้าสู่ระบบเพื่อจัดการคิว QR Code ทีมงาน และข้อมูลร้านค้า
            </p>
            <form onSubmit={submit} style={{ marginTop: 24 }}>
                <div className="input-group">
                    <label>อีเมล</label>
                    <input type="email" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} required />
                </div>
                <div className="input-group">
                    <label>รหัสผ่าน</label>
                    <input type="password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} required />
                </div>
                <button className="btn btn-primary" disabled={submitting}>{submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}</button>
            </form>
            <p style={{ textAlign: 'center', marginTop: 20 }}>
                ยังไม่มีบัญชีร้านค้า? <Link to="/register">สมัครร้านค้า</Link>
            </p>
        </div>
    );
}
