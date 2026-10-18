import { Bot, CheckCircle2, ClipboardCheck, Mail, RefreshCw, ShieldCheck, Stethoscope } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Panel from '../components/ui/Panel';
import EmptyState from '../components/ui/EmptyState';
import { useAppStore } from '../store/useAppStore';

const statusClass = {
  ok: 'success',
  managed: 'success',
  planned: 'neutral',
  stale: 'neutral',
  no_recent_data: 'neutral',
  error: 'danger'
};

export default function Operations() {
  const ops = useAppStore((state) => state.ops);
  const autoApplyPreview = useAppStore((state) => state.autoApplyPreview);
  const loadOps = useAppStore((state) => state.loadOps);
  const saveOpsSettings = useAppStore((state) => state.saveOpsSettings);
  const refreshOpsHealth = useAppStore((state) => state.refreshOpsHealth);
  const previewAutoApply = useAppStore((state) => state.previewAutoApply);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    loadOps().then((data) => setDraft(data.settings)).catch(() => {});
  }, [loadOps]);

  useEffect(() => {
    if (ops?.settings) setDraft(ops.settings);
  }, [ops?.settings]);

  const candidateSummary = useMemo(() => {
    const rows = autoApplyPreview?.candidates || [];
    return {
      total: rows.length,
      supported: rows.filter((item) => item.supported).length,
      resumeReady: rows.filter((item) => item.resumeReady).length
    };
  }, [autoApplyPreview]);

  const updateAutoApply = (patch) =>
    setDraft((current) => ({
      ...(current || {}),
      autoApply: { ...(current?.autoApply || {}), ...patch }
    }));

  const updateNotifications = (patch) =>
    setDraft((current) => ({
      ...(current || {}),
      notifications: { ...(current?.notifications || {}), ...patch }
    }));

  if (!ops || !draft) {
    return <div className="page-loader">Loading operations...</div>;
  }

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Operations</div>
          <h1>Roadmap controls for safe automation and stability.</h1>
          <p>
            P0 to P3 capabilities are now surfaced as managed controls: scraper health, duplicate detection,
            safe auto-apply preview, score reports, notifications, and output-link stability.
          </p>
        </div>
        <div className="hero-actions">
          <button className="secondary-button" type="button" onClick={() => refreshOpsHealth()}>
            <RefreshCw size={16} /> Refresh Health
          </button>
          <button className="primary-button" type="button" onClick={() => previewAutoApply({ minScore: draft.autoApply.minScore })}>
            <Bot size={16} /> Preview Apply
          </button>
        </div>
      </section>

      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-top"><span>Phases Managed</span><ClipboardCheck size={16} /></div>
          <strong>{ops.phases.filter((item) => item.status === 'managed').length}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Healthy Sources</span><Stethoscope size={16} /></div>
          <strong>{ops.health.filter((item) => item.status === 'ok').length}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Duplicates</span><ShieldCheck size={16} /></div>
          <strong>{ops.dedup.duplicateCount}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Preview Jobs</span><Bot size={16} /></div>
          <strong>{candidateSummary.total}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Supported</span><CheckCircle2 size={16} /></div>
          <strong>{candidateSummary.supported}</strong>
        </article>
        <article className="stat-card">
          <div className="stat-top"><span>Resume Ready</span><Mail size={16} /></div>
          <strong>{candidateSummary.resumeReady}</strong>
        </article>
      </section>

      <Panel title="Phase coverage" subtitle="Roadmap mapped to current zero-cost architecture">
        <div className="ops-phase-grid">
          {ops.phases.map((phase) => (
            <article key={phase.id} className="ops-phase-card">
              <div className="ops-phase-head">
                <strong>{phase.label}</strong>
                <span className={`chip ${statusClass[phase.status] || 'neutral'}`}>{phase.status}</span>
              </div>
              <ul className="check-list">
                {phase.items.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </Panel>

      <Panel title="Automation settings" subtitle="Safe-submit mode remains enforced for v1">
        <div className="form-grid">
          <label>
            Minimum apply score
            <input
              className="text-input"
              type="number"
              min="1"
              max="10"
              step="0.5"
              value={draft.autoApply.minScore}
              onChange={(event) => updateAutoApply({ minScore: Number(event.target.value) })}
            />
          </label>
          <label>
            Notification email
            <input
              className="text-input"
              value={draft.notifications.to}
              onChange={(event) => updateNotifications({ to: event.target.value })}
              placeholder="you@gmail.com"
            />
          </label>
        </div>
        <div className="checkbox-grid ops-toggle-grid">
          <label><input type="checkbox" checked={draft.autoApply.enabled} onChange={(event) => updateAutoApply({ enabled: event.target.checked })} /> Auto-apply queue enabled</label>
          <label><input type="checkbox" checked={draft.autoApply.safeSubmitOnly} disabled readOnly /> Safe submit only</label>
          <label><input type="checkbox" checked={draft.notifications.enabled} onChange={(event) => updateNotifications({ enabled: event.target.checked })} /> Email notifications</label>
        </div>
        <button className="primary-button" type="button" onClick={() => saveOpsSettings(draft)}>
          Save Operations
        </button>
      </Panel>

      <Panel title="Scraper health" subtitle="Broken or stale sources are visible before a batch">
        <div className="ops-health-list">
          {ops.health.map((item) => (
            <div key={item.platform} className="status-card">
              <div>
                <strong>{item.platform}</strong>
                <p>{item.count} rows, {item.errors} errors{item.ageHours == null ? '' : `, ${item.ageHours}h old`}</p>
              </div>
              <span className={`chip ${statusClass[item.status] || 'neutral'}`}>{item.status}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Safe auto-apply preview" subtitle="Final submit is intentionally manual">
        {autoApplyPreview?.candidates?.length ? (
          <div className="ops-health-list">
            {autoApplyPreview.candidates.slice(0, 12).map((item) => (
              <div key={item.id} className="status-card">
                <div>
                  <strong>{item.company} - {item.role}</strong>
                  <p>{item.platform} - score {item.score}/10 - {item.resumeReady ? 'resume linked' : 'resume missing'}</p>
                </div>
                <span className={`chip ${item.supported ? 'success' : 'neutral'}`}>{item.supported ? 'ready' : 'manual'}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No preview yet" body="Run Preview Apply to see supported Greenhouse, Lever, and Internshala listings here." />
        )}
      </Panel>
    </div>
  );
}
