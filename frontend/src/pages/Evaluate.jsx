import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Panel from '../components/ui/Panel';
import ScoreBar from '../components/ui/ScoreBar';
import GradeBadge from '../components/ui/GradeBadge';
import EmptyState from '../components/ui/EmptyState';
import Terminal from '../components/ui/Terminal';
import { useAppStore } from '../store/useAppStore';

export default function Evaluate() {
  const navigate = useNavigate();
  const runEvaluate = useAppStore((state) => state.runEvaluate);
  const activeEvaluation = useAppStore((state) => state.activeEvaluation);
  const scanResults = useAppStore((state) => state.scanResults);
  const [tab, setTab] = useState('paste');
  const [payload, setPayload] = useState({ jd: '', url: '', selectedScanUrl: '' });

  const selectedScan = useMemo(
    () => scanResults.find((item) => item.url === payload.selectedScanUrl),
    [payload.selectedScanUrl, scanResults]
  );

  const result = activeEvaluation.result;

  return (
    <div className="two-up-grid">
      <Panel title="Input panel" subtitle="Paste JD, URL, or pull from scan list">
        <div className="tab-row">
          {[
            ['paste', 'Paste JD'],
            ['url', 'Enter URL'],
            ['scan', 'From Scan List']
          ].map(([value, label]) => (
            <button key={value} type="button" className={`tab-button ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'paste' ? (
          <textarea className="text-area" rows="12" placeholder="Paste job description..." value={payload.jd} onChange={(e) => setPayload({ ...payload, jd: e.target.value })} />
        ) : null}
        {tab === 'url' ? (
          <input className="text-input" placeholder="https://job-posting-url" value={payload.url} onChange={(e) => setPayload({ ...payload, url: e.target.value })} />
        ) : null}
        {tab === 'scan' ? (
          <select className="status-select" value={payload.selectedScanUrl} onChange={(e) => setPayload({ ...payload, selectedScanUrl: e.target.value })}>
            <option value="">Select a scanned job</option>
            {scanResults.map((item) => (
              <option key={item.url} value={item.url}>
                {item.company} - {item.role}
              </option>
            ))}
          </select>
        ) : null}

        <button
          className="primary-button"
          type="button"
          onClick={() => runEvaluate({ inputMode: tab, ...payload, scanItem: selectedScan })}
        >
          Evaluate
        </button>
      </Panel>

      <Panel title="Results panel" subtitle="Evaluation card with score, strengths, gaps, and action plan">
        <Terminal
          logs={activeEvaluation.logs}
          status={activeEvaluation.status}
          title="bridge://evaluate-stream"
          idleMessage="Evaluate idle. Start a run to watch Gemini progress here."
        />
        {result ? (
          <div className="result-stack">
            <div className="result-header">
              <div>
                <h3>{result.company}</h3>
                <p>{result.role} • {result.location}</p>
              </div>
              <GradeBadge grade={result.grade} />
            </div>
            <ScoreBar score={result.score} />
            <div className="chip-row">
              <span className="chip neutral">{result.verdict}</span>
              {result.salary_estimate ? <span className="chip neutral">{result.salary_estimate}</span> : null}
            </div>
            <p>{result.fit_summary}</p>
            <div>
              <div className="mini-label">Strengths</div>
              <div className="chip-row">{(result.strengths || []).map((item) => <span key={item} className="chip success">{item}</span>)}</div>
            </div>
            <div>
              <div className="mini-label">Gaps</div>
              <div className="chip-row">{(result.gaps || []).map((item) => <span key={item} className="chip danger">{item}</span>)}</div>
            </div>
            <div className="detail-grid">
              <div>
                <div className="mini-label">Interview Prep</div>
                <ol className="number-list">{(result.interview_prep || []).map((item) => <li key={item}>{item}</li>)}</ol>
              </div>
              <div>
                <div className="mini-label">Action Items</div>
                <ul className="check-list">{(result.action_items || []).map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate(result?.id ? `/resume?jobId=${result.id}` : '/resume')}
            >
              Generate Tailored Resume
            </button>
          </div>
        ) : (
          <EmptyState title="Paste a JD to begin" body="Paste a job description above and run evaluation to see detailed fit analysis and scores." />
        )}
      </Panel>
    </div>
  );
}
