import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  return (
    <div className="auth-shell">
      <div className="auth-brand-panel">
        <div className="brand-mark">JOB-OPS</div>
        <h1>From CLI workflow to operator-grade job cockpit.</h1>
        <p>
          Auth flow is ready with `experience` captured from day one, so later MySQL integration me user profile
          directly persist ho sake.
        </p>
        <div className="auth-highlight-grid">
          <div className="glass-card">
            <span>Scanner</span>
            <strong>Multi-source pipeline</strong>
          </div>
          <div className="glass-card">
            <span>Evaluator</span>
            <strong>Fit score + gaps + prep</strong>
          </div>
          <div className="glass-card">
            <span>Resume</span>
            <strong>Tailored output contracts</strong>
          </div>
        </div>
      </div>
      <div className="auth-form-panel">
        <Outlet />
      </div>
    </div>
  );
}
