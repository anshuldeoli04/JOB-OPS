import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { api } from '../api/client';

const initialForm = {
  name: '',
  email: '',
  password: '',
  experienceLevel: 'fresher',
  experienceYears: 0,
  targetRole: 'Software Engineer',
  cvContent: ''
};

export default function Signup() {
  const navigate = useNavigate();
  const signup = useAppStore((state) => state.signup);
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState('');

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault();
        setSubmitting(true);
        setError('');
        try {
          await signup(form);
          navigate('/');
        } catch (err) {
          setError(err?.response?.data?.error || 'Signup failed');
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <div className="eyebrow">Create workspace access</div>
        <h2>Signup + profile bootstrap</h2>
        <p className="muted-copy">Provide your credentials and professional details to set up your workspace.</p>
      </div>
      <label>
        Full name
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      </label>
      <label>
        Password <span className="muted-copy">(min 10 characters, no spaces)</span>
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={10} />
      </label>
      <div className="auth-grid">
        <label>
          Experience level
          <select value={form.experienceLevel} onChange={(e) => setForm({ ...form, experienceLevel: e.target.value })}>
            <option value="fresher">fresher</option>
            <option value="0-1yr">0-1yr</option>
            <option value="1-3yr">1-3yr</option>
            <option value="3+yr">3+yr</option>
          </select>
        </label>
        <label>
          Experience years
          <input type="number" min="0" step="0.5" value={form.experienceYears} onChange={(e) => setForm({ ...form, experienceYears: Number(e.target.value) })} />
        </label>
      </div>
      <label>
        Primary target role
        <input value={form.targetRole} onChange={(e) => setForm({ ...form, targetRole: e.target.value })} />
      </label>
      <label>
        Resume PDF
        <input
          type="file"
          accept=".pdf,application/pdf"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              setPdfLoading(true);
              setError('');
              const data = await api.uploadCvPdf(file);
              setForm((prev) => ({ ...prev, cvContent: data.cv_content }));
            } catch (err) {
              setError(err?.response?.data?.error || 'PDF parse failed');
            } finally {
              setPdfLoading(false);
            }
          }}
          required={!form.cvContent}
        />
      </label>
      {pdfLoading ? <p className="muted-copy">Parsing PDF resume...</p> : null}
      <label>
        Resume / CV preview
        <textarea
          className="text-area"
          rows="8"
          placeholder="Extracted resume text will appear here after PDF upload. You can review and edit it before continuing."
          value={form.cvContent}
          onChange={(e) => setForm({ ...form, cvContent: e.target.value })}
          required
        />
      </label>
      {error ? <div className="inline-error">{error}</div> : null}
      <button className="primary-button" type="submit" disabled={submitting}>
        {submitting ? 'Creating...' : 'Create account'}
      </button>
      <p className="muted-copy">
        Already have an account? <Link to="/auth/login">Login</Link>
      </p>
    </form>
  );
}
