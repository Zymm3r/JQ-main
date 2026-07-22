import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api';
import { saveAccountSession } from '../utils/account';

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
            toast.success('Account created');
            navigate('/onboarding');
        } catch (error) {
            toast.error(error.response?.data?.error || 'Registration failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="card" style={{ maxWidth: 520, margin: '30px auto', textAlign: 'left' }}>
            <h2>Register merchant account</h2>
            <p style={{ color: 'var(--text-light)', margin: '8px 0 24px' }}>
                Create the owner account first. After email verification, you can submit store details for platform review.
            </p>
            <form onSubmit={submit}>
                <Field label="Owner name" value={form.name} onChange={name => setForm({ ...form, name })} />
                <Field label="Email" type="email" value={form.email} onChange={email => setForm({ ...form, email })} />
                <Field label="Phone number" value={form.phone} onChange={phone => setForm({ ...form, phone })} />
                <Field label="Password (at least 10 characters)" type="password" value={form.password} onChange={password => setForm({ ...form, password })} minLength={10} />
                <label style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-start' }}>
                    <input type="checkbox" checked={form.acceptedTerms} onChange={event => setForm({ ...form, acceptedTerms: event.target.checked })} required />
                    <span>I accept the service terms and privacy policy.</span>
                </label>
                <button className="btn btn-primary" disabled={submitting}>{submitting ? 'Creating account...' : 'Create account'}</button>
            </form>
            <p style={{ textAlign: 'center', marginTop: 20 }}>
                Already registered? <Link to="/login">Sign in</Link>
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
