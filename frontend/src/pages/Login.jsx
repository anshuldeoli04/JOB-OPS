import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export default function Login() {
  const navigate = useNavigate();
  const login = useAppStore((state) => state.login);
  const [form, setForm] = useState({ email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
          await login(form);
          navigate('/');
        } catch (err) {
          setError(err?.response?.data?.error || 'Login failed');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <div className="eyebrow">Welcome back</div>
        <h2>Sign in to JOB-OPS</h2>
        <p className="muted-copy">Track applications, evaluations, and resume workflows from one place.</p>
      </div>
      <label>
        Email
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      </label>
      <label>
        Password
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      </label>
      {error ? <div className="inline-error">{error}</div> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? 'Signing in...' : 'Login'}
      </button>
      <p className="muted-copy">
        New here? <Link to="/auth/signup">Create account</Link>
      </p>
    </form>
  );
}
