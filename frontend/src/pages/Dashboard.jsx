import { useMemo } from 'react';
import { BriefcaseBusiness, CircleDashed, ScanSearch, Sparkles, Trophy, WalletCards } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import Panel from '../components/ui/Panel';
import GradeBadge from '../components/ui/GradeBadge';
import ScoreBar from '../components/ui/ScoreBar';
import EmptyState from '../components/ui/EmptyState';
import { useAppStore } from '../store/useAppStore';

const colors = {
  A: 'var(--grade-a)',
  B: 'var(--grade-b)',
  C: 'var(--grade-c)',
  D: 'var(--grade-d)',
  F: 'var(--grade-f)'
};

function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/');
}

export default function Dashboard() {
  const applications = useAppStore((state) => state.applications);
  const activity = useAppStore((state) => state.activity);
  const runScan = useAppStore((state) => state.runScan);
  const usage = useAppStore((state) => state.usage);

  const stats = useMemo(() => [
    { label: 'Total Evaluated', value: applications.length, icon: CircleDashed },
    { label: 'Grade A Jobs', value: applications.filter((item) => item.grade === 'A').length, icon: Trophy },
    { label: 'Applied', value: applications.filter((item) => ['applied', 'interview', 'offer'].includes(item.status)).length, icon: BriefcaseBusiness },
    { label: 'Interviews', value: applications.filter((item) => item.status === 'interview').length, icon: Sparkles },
    { label: 'Offers', value: applications.filter((item) => item.status === 'offer').length, icon: WalletCards },
    {
      label: 'Avg Match Score',
      value: applications.length ? (applications.reduce((sum, item) => sum + (item.score || 0), 0) / applications.length).toFixed(1) : '0.0',
      icon: ScanSearch
    }
  ], [applications]);

  const chartData = useMemo(() => ['A', 'B', 'C', 'D', 'F']
    .map((grade) => ({ name: grade, value: applications.filter((item) => item.grade === grade).length }))
    .filter((item) => item.value > 0), [applications]);

  const topMatches = useMemo(() => applications
    .filter((item) => ['A', 'B'].includes(item.grade))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 6), [applications]);

  return (
    <div className="page-grid">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1>Modern frontend shell is now mapped to your existing job data.</h1>
          <p>
            Unified dashboard providing visibility into job scans, evaluations, application pipelines, and Gemini usage.
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-button" type="button" onClick={() => runScan({ mode: 'scan' })}>
            Run Scanner
          </button>
          <button className="secondary-button" type="button" onClick={() => runScan({ mode: 'autoflow' })}>
            AutoFlow
          </button>
        </div>
      </section>

      <section className="stats-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <article key={label} className="stat-card">
            <div className="stat-top">
              <span>{label}</span>
              <Icon size={16} />
            </div>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <Panel title="Grade distribution" subtitle="Animated donut-ready summary from applications.json">
        {chartData.length ? (
          <div className="chart-layout">
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" innerRadius={72} outerRadius={96} paddingAngle={3}>
                    {chartData.map((entry) => (
                      <Cell key={entry.name} fill={colors[entry.name]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="legend-stack">
              {chartData.map((item) => (
                <div key={item.name} className="legend-row">
                  <span className="legend-swatch" style={{ background: colors[item.name] }} />
                  <span>Grade {item.name}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState title="No application data" body="Run scanner or evaluator to populate the dashboard metrics." />
        )}
      </Panel>

      <Panel title="Recent activity" subtitle="Last 10 actions rendered from bridge activity feed">
        <div className="activity-list">
          {(activity || []).slice(0, 10).map((item) => (
            <div key={item.id} className="activity-row">
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
              <span>{new Date(item.timestamp).toLocaleString('en-IN')}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Gemini usage" subtitle="Daily free-tier visibility">
        <div className="stack-gap">
          <div className="status-card">
            <div>
              <strong>{usage?.today || 0} / ~{usage?.limit_estimate || 1500} calls today</strong>
              <p>Daily Gemini usage tracker for current workspace.</p>
            </div>
            <span className="chip neutral">Tracked</span>
          </div>
        </div>
      </Panel>

      <Panel title="Top matches" subtitle="Grade A/B rows only">
        {topMatches.length ? (
          <div className="top-match-list">
            {topMatches.map((item) => (
              <div key={item.id} className="top-match-row">
                <div className="top-match-main">
                  <GradeBadge grade={item.grade} />
                  <div>
                    <strong>{item.company}</strong>
                    <p>{item.role}</p>
                  </div>
                </div>
                <div className="top-match-side">
                  <ScoreBar score={item.score} />
                  {isSafeUrl(item.apply_url || item.url) ? (
                    <a href={item.apply_url || item.url} target="_blank" rel="noreferrer" className="primary-link">
                      Apply + Resume
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No strong matches yet" body="Top matching jobs with grade A or B will appear here." />
        )}
      </Panel>
    </div>
  );
}
