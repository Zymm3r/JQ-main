import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, Circle } from 'lucide-react';
import { api } from '../api';
import { clearAccountSession, getAccountToken } from '../utils/account';

const errorMessages = {
    'Invalid or expired verification code': 'รหัสยืนยันไม่ถูกต้องหรือหมดอายุ',
    'Please wait before requesting another code': 'กรุณารอสักครู่ก่อนขอรหัสใหม่',
    'Unable to send verification code': 'ส่งรหัสยืนยันไม่สำเร็จ',
    'Verification failed': 'ยืนยันอีเมลไม่สำเร็จ'
};

function thaiError(error, fallback = 'ทำรายการไม่สำเร็จ') {
    const message = error.response?.data?.error;
    return errorMessages[message] || message || fallback;
}

export default function Onboarding() {
    const navigate = useNavigate();
    const [profile, setProfile] = useState(null);
    const [code, setCode] = useState(localStorage.getItem('dev_verification_code') || '');

    useEffect(() => {
        if (!getAccountToken()) { navigate('/login'); return; }
        api.get('/auth/me').then(({ data }) => setProfile(data)).catch(() => {
            clearAccountSession();
            navigate('/login');
        });
    }, [navigate]);

    const verify = async event => {
        event.preventDefault();
        try {
            await api.post('/auth/verify-email', { code });
            localStorage.removeItem('dev_verification_code');
            const { data } = await api.get('/auth/me');
            setProfile(data);
            toast.success('ยืนยันอีเมลสำเร็จ');
        } catch (error) {
            toast.error(thaiError(error));
        }
    };

    const resend = async () => {
        try {
            const { data } = await api.post('/auth/send-verification');
            if (data.devVerificationCode) {
                localStorage.setItem('dev_verification_code', data.devVerificationCode);
                setCode(data.devVerificationCode);
            }
            toast.success('ส่งรหัสยืนยันแล้ว');
        } catch (error) {
            toast.error(thaiError(error, 'ส่งรหัสยืนยันไม่สำเร็จ'));
        }
    };

    if (!profile) return <div className="card">กำลังโหลด...</div>;
    const verified = profile.user.emailVerified;
    const setupComplete = Boolean(profile.store?.name && profile.store?.slug);

    return (
        <div className="card" style={{ maxWidth: 620, margin: '30px auto', textAlign: 'left' }}>
            <h2>เริ่มต้นใช้งานร้านค้า</h2>
            <p style={{ color: 'var(--text-light)', marginTop: 8 }}>Store ID: <code>{profile.store?.storeId}</code></p>
            <div style={{ margin: '24px 0' }}>
                <Step done title="สร้างบัญชี" />
                <Step done={verified} title="ยืนยันอีเมล" />
                <Step done={setupComplete} title="กรอกข้อมูลร้านและหลักฐาน" />
                <Step done={profile.store?.verificationStatus === 'pending_verification'} title="ส่งให้แพลตฟอร์มตรวจสอบ" />
                <Step done={profile.store?.verificationStatus === 'verified'} title="อนุมัติและเปิดใช้งานร้าน" />
            </div>
            {!verified ? (
                <form onSubmit={verify}>
                    <div className="input-group">
                        <label>รหัส OTP 6 หลัก</label>
                        <input inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value)} required />
                    </div>
                    <button className="btn btn-primary">ยืนยันอีเมล</button>
                    <button type="button" className="btn btn-secondary" style={{ marginTop: 10 }} onClick={resend}>ส่งรหัสอีกครั้ง</button>
                </form>
            ) : (
                <Link className="btn btn-primary" to="/store/setup">ตั้งค่าข้อมูลร้าน</Link>
            )}
        </div>
    );
}

function Step({ done, title }) {
    return <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', color: done ? 'var(--success)' : 'var(--text-light)' }}>{done ? <CheckCircle size={20} /> : <Circle size={20} />}<span>{title}</span></div>;
}
