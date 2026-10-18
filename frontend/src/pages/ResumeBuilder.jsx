import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Panel from '../components/ui/Panel';
import GradeBadge from '../components/ui/GradeBadge';
import EmptyState from '../components/ui/EmptyState';
import Terminal from '../components/ui/Terminal';
import { useAppStore } from '../store/useAppStore';
import { api } from '../api/client';

function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/');
}

export default function ResumeBuilder() {
  const [searchParams] = useSearchParams();
  const queryJobId = searchParams.get('jobId') || '';
  const applications = useAppStore((state) => state.applications);
  const runResume = useAppStore((state) => state.runResume);
  const activeResume = useAppStore((state) => state.activeResume);
  const [selectedId, setSelectedId] = useState(queryJobId);

  useEffect(() => {
    if (queryJobId) {
      setSelectedId(queryJobId);
    }
  }, [queryJobId]);

  const jobs = useMemo(
    () =>
      [...applications].sort((a, b) => {
        const rank = { A: 4, B: 3, C: 2, D: 1, F: 0 };
        return (rank[b.grade] || 0) - (rank[a.grade] || 0) || (b.score || 0) - (a.score || 0);
      }),
    [applications]
  );

  const effectiveId = selectedId || queryJobId;
  const selectedJob = jobs.find((item) => item.id === effectiveId) || jobs[0];

  return (
    <div className="two-up-grid">
      <Panel title="Job selector" subtitle="Grade-first shortlist for tailored resume generation">
        {jobs.length ? (
          <div className="resume-job-list">
            {jobs.slice(0, 12).map((job) => (
              <button key={job.id} type="button" className={`resume-job-card ${selectedJob?.id === job.id ? 'active' : ''}`} onClick={() => setSelectedId(job.id)}>
                <div className="resume-job-head">
                  <strong>{job.company}</strong>
                  <GradeBadge grade={job.grade} />
                </div>
                <p>{job.role}</p>
                <span>{Number(job.score).toFixed(1)} / 10</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title="No evaluated jobs yet" body="Evaluated jobs will appear here once applications are loaded." />
        )}

        {selectedJob ? (
          <div className="toolbar-inline">
            <button className="primary-button" type="button" onClick={() => runResume({ jobId: selectedJob.id })}>
              Generate Resume
            </button>
            <button className="secondary-button" type="button" onClick={() => runResume({ jobId: selectedJob.id, regenerate: true })}>
              Regenerate
            </button>
          </div>
        ) : null}
      </Panel>

      <Panel title="Resume preview" subtitle="Preview contract for HTML/PDF output">
        {selectedJob ? (
          <div className="resume-preview">
            <div className="resume-preview-card">
              <div className="mini-label">Selected job</div>
              <h3>{selectedJob.company}</h3>
              <p>{selectedJob.role}</p>
              <div className="chip-row">
                {(selectedJob.strengths || []).slice(0, 5).map((item) => <span key={item} className="chip neutral">{item}</span>)}
              </div>
            </div>
            <div className="preview-box">
              <Terminal
                logs={activeResume.logs}
                status={activeResume.status}
                title="bridge://resume-stream"
                idleMessage="Resume builder idle. Start a generation to watch live output here."
              />
              {activeResume.status === 'success' ? (
                <>
                  <p>{activeResume.result.message}</p>
                  {activeResume.result.logs?.length ? (
                    <pre className="log-preview">{activeResume.result.logs.slice(-12).join('\n')}</pre>
                  ) : null}
                  <div className="toolbar-inline">
                    {isSafeUrl(activeResume.result.resume_pdf) ? (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => api.openProtectedFile(activeResume.result.resume_pdf)}
                      >
                        Download PDF
                      </button>
                    ) : null}
                    {isSafeUrl(activeResume.result.resume_html) ? (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => api.openProtectedFile(activeResume.result.resume_html)}
                      >
                        Download HTML
                      </button>
                    ) : null}
                  </div>
                </>
              ) : (
                <p>Generating with Gemini AI... Preview will render here once generation completes.</p>
              )}
            </div>
          </div>
        ) : (
          <EmptyState title="Select a job" body="The resume preview activates when an application is selected." />
        )}
      </Panel>
    </div>
  );
}
