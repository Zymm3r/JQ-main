import { Link } from 'react-router-dom';
import { createElement } from 'react';
import { CheckCircle2, LineChart, MessageCircle, QrCode, ShieldCheck, Store, Users } from 'lucide-react';

const steps = [
    ['1', 'ร้านค้าสมัครสมาชิก', 'สร้างบัญชีร้านค้า กรอกข้อมูลร้าน และส่งให้แพลตฟอร์มตรวจสอบก่อนเปิดใช้งาน'],
    ['2', 'แพลตฟอร์มตรวจสอบร้าน', 'ทีมงานอนุมัติร้านก่อนที่หน้าจองคิวผ่าน LIFF จะเริ่มรับคิวจากลูกค้าได้'],
    ['3', 'ร้านพิมพ์ QR ของตัวเอง', 'แต่ละร้านมี QR/LIFF link เฉพาะร้าน ลูกค้าสแกนด้วย LINE แล้วจองคิวได้ทันที'],
    ['4', 'แจ้งเตือนผ่าน LINE OA กลาง', 'ระบบส่งข้อความยืนยันคิวและเรียกคิวผ่าน LINE Official Account ของแพลตฟอร์ม']
];

const features = [
    [QrCode, 'QR เฉพาะแต่ละร้าน', 'QR ทุกใบผูกกับร้านที่ผ่านการยืนยันแล้ว พร้อมแยก source สำหรับหน้าร้าน สาขา หรือแคมเปญ'],
    [MessageCircle, 'แจ้งเตือนผ่าน LINE กลาง', 'MVP นี้ร้านค้าไม่ต้องต่อ LINE OA เอง ระบบกลางเป็นผู้ส่งข้อความให้ลูกค้า'],
    [ShieldCheck, 'ข้อมูลร้านไม่ปนกัน', 'คำสั่งฝั่งร้านใช้ storeId จาก token เท่านั้น ไม่เชื่อ storeId ที่ส่งมาจาก body'],
    [Users, 'พร้อมรองรับทีมงาน', 'โครงสร้างรองรับ owner, manager, staff และ viewer โดยไม่ต้องรื้อระบบใหญ่ภายหลัง']
];

export default function Home() {
    return (
        <main style={{ maxWidth: 980, margin: '0 auto', padding: '36px 18px 56px' }}>
            <section className="card" style={{
                padding: 32,
                background: 'linear-gradient(135deg, #eff6ff 0%, #ffffff 46%, #f0fdf4 100%)',
                border: '1px solid #dbeafe'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#2563eb', fontWeight: 800, marginBottom: 18 }}>
                    <Store size={22} />
                    JQ ระบบจัดการคิวผ่าน LINE สำหรับหลายร้าน
                </div>
                <h1 style={{ fontSize: 'clamp(2rem, 6vw, 4rem)', lineHeight: 1.04, marginBottom: 18 }}>
                    ให้ลูกค้าจองคิวผ่าน LINE โดยร้านค้าไม่ต้องทำบอทเอง
                </h1>
                <p style={{ color: '#475569', fontSize: '1.08rem', lineHeight: 1.7, maxWidth: 760 }}>
                    ร้านค้าสมัครและยืนยันตัวตนกับแพลตฟอร์ม จากนั้นสร้าง QR เฉพาะร้านให้ลูกค้าสแกน
                    ลูกค้าจองผ่าน LINE LIFF และรับข้อความแจ้งเตือนจาก LINE Official Account กลางของระบบ
                </p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 26 }}>
                    <Link className="btn btn-primary" to="/register" style={{ width: 'auto', textDecoration: 'none' }}>สมัครร้านค้า</Link>
                    <Link className="btn btn-secondary" to="/login" style={{ width: 'auto', textDecoration: 'none' }}>เข้าสู่ระบบร้านค้า</Link>
                    <Link className="btn btn-secondary" to="/liff/demo-shabu-1?source=main" style={{ width: 'auto', textDecoration: 'none' }}>ดูตัวอย่างหน้าจองคิว</Link>
                </div>
            </section>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginTop: 18 }}>
                {features.map(([Icon, title, text]) => (
                    <div className="card" key={title} style={{ padding: 20 }}>
                        {createElement(Icon, { size: 26, color: '#2563eb' })}
                        <h3 style={{ marginTop: 12 }}>{title}</h3>
                        <p style={{ color: '#64748b', lineHeight: 1.55, marginTop: 8 }}>{text}</p>
                    </div>
                ))}
            </section>

            <section className="card" style={{ marginTop: 18, padding: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                    <LineChart color="#16a34a" />
                    <h2>ขั้นตอนการใช้งานแบบเรียบง่าย</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
                    {steps.map(([number, title, text]) => (
                        <div key={number} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 16 }}>
                            <div style={{
                                width: 34, height: 34, borderRadius: 17, background: '#dbeafe', color: '#1d4ed8',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800
                            }}>{number}</div>
                            <h3 style={{ marginTop: 12 }}>{title}</h3>
                            <p style={{ color: '#64748b', lineHeight: 1.55, marginTop: 8 }}>{text}</p>
                        </div>
                    ))}
                </div>
            </section>

            <section className="card" style={{ marginTop: 18, padding: 22, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <CheckCircle2 color="#16a34a" />
                <div>
                    <h3>แนวทางปัจจุบัน</h3>
                    <p style={{ color: '#64748b', lineHeight: 1.6, marginTop: 6 }}>
                        ระบบนี้ยังเปิดให้ร้านค้าใช้งานแบบฟรี โดยนับสถิติการส่ง LINE เพื่อดูการใช้งานและต้นทุน
                        แต่ไม่ใช้แพ็กเกจหรือ subscription มาจำกัดการรับคิวของร้านค้า
                    </p>
                </div>
            </section>
        </main>
    );
}
