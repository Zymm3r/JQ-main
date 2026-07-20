import { NavLink, useNavigate } from 'react-router-dom';
import { createElement } from 'react';
import { ListOrdered, Monitor, QrCode, Settings, CreditCard, Users, LogOut } from 'lucide-react';

const items = [
    ['/store/queues', 'คิว', ListOrdered],
    ['/store/monitor', 'หน้าจอ Monitor', Monitor],
    ['/store/qr', 'QR Code', QrCode],
    ['/store/setup', 'ตั้งค่าร้าน', Settings],
    ['/store/team', 'พนักงานและสาขา', Users],
    ['/store/package', 'แพ็กเกจ', CreditCard]
];

export default function MerchantNav() {
    const navigate = useNavigate();
    const membershipRole = (() => {
        try { return JSON.parse(localStorage.getItem('account_store') || '{}').membership?.role; }
        catch { return null; }
    })();
    const visibleItems = items.filter(([to]) => to !== '/store/team' || ['owner', 'manager'].includes(membershipRole));
    const logout = () => {
        const platformToken = localStorage.getItem('platform_account_token');
        if (platformToken) {
            localStorage.setItem('account_token', platformToken);
            localStorage.removeItem('platform_account_token');
            localStorage.removeItem('account_store');
            localStorage.removeItem('active_branch_id');
            navigate('/platform-admin');
            return;
        }
        localStorage.removeItem('account_token');
        localStorage.removeItem('active_branch_id');
        navigate('/login');
    };
    return (
        <nav style={{ background: '#172554', color: 'white', padding: '12px 18px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ marginRight: 12 }}>Merchant</strong>
            {visibleItems.map(([to, label, Icon]) => (
                <NavLink key={to} to={to} style={({ isActive }) => ({
                    color: 'white', textDecoration: 'none', padding: '9px 12px', borderRadius: 9,
                    display: 'flex', alignItems: 'center', gap: 6, background: isActive ? '#2563eb' : 'transparent'
                })}>{createElement(Icon, { size: 17 })}{label}</NavLink>
            ))}
            <button onClick={logout} style={{ marginLeft: 'auto', background: 'transparent', color: 'white', border: 0, display: 'flex', gap: 6, cursor: 'pointer' }}><LogOut size={17} />{localStorage.getItem('platform_account_token') ? 'กลับ Platform Admin' : 'ออกจากระบบ'}</button>
        </nav>
    );
}
