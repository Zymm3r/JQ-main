import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle, Circle } from 'lucide-react';
import { api } from '../api';
import { clearAccountSession, getAccountToken } from '../utils/account';

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
            toast.success('Email verified');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Verification failed');
        }
    };

    const resend = async () => {
        try {
            const { data } = await api.post('/auth/send-verification');
            if (data.devVerificationCode) {
                localStorage.setItem('dev_verification_code', data.devVerificationCode);
                setCode(data.devVerificationCode);
            }
            toast.success('Verification code sent');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Unable to resend code');
        }
    };

    if (!profile) return <div className="card">Loading...</div>;
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
                <Step done={profile.store?.verificationStatus === 'pending_verification'} title="ส่งตรวจสอบ" />
                <Step done={profile.store?.verificationStatus === 'verified'} title="อนุมัติและเปิดใช้งานร้าน" />
            </div>
            {!verified ? (
                <form onSubmit={verify}>
                    <div className="input-group"><label>รหัส OTP 6 หลัก</label><input inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={event => setCode(event.target.value)} required /></div>
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
