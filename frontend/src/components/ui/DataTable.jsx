import GradeBadge from './GradeBadge';
import ScoreBar from './ScoreBar';
import StatusBadge from './StatusBadge';
import { Fragment } from 'react';
import { api } from '../../api/client';

function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/');
}

export default function DataTable({
  rows,
  expandedId,
  onExpand,
  selectedIds = [],
  onSelect,
  onSelectAll,
  onStatusChange
}) {
  const allSelected = rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>
              <input type="checkbox" checked={allSelected} onChange={(e) => onSelectAll(e.target.checked)} aria-label="Select all applications" />
            </th>
            <th>Grade</th>
            <th>Score</th>
            <th>Company</th>
            <th>Role</th>
            <th>Location</th>
            <th>Status</th>
            <th>Actions</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isExpanded = expandedId === row.id;
            return (
              <Fragment key={row.id}>
                <tr className="clickable-row" onClick={() => onExpand(isExpanded ? null : row.id)}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(row.id)}
                      onChange={(e) => onSelect(row.id, e.target.checked)}
                      aria-label={`Select ${row.company}`}
                    />
                  </td>
                  <td><GradeBadge grade={row.grade} /></td>
                  <td><ScoreBar score={row.score} /></td>
                  <td>{row.company}</td>
                  <td>{row.role}</td>
                  <td>{row.location || '-'}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <select value={row.status || 'evaluated'} onChange={(e) => onStatusChange(row.id, e.target.value)} className="status-select">
                      {['evaluated', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'].map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <div className="row-actions">
                      {isSafeUrl(row.apply_url || row.url) ? (
                        <a href={row.apply_url || row.url} target="_blank" rel="noreferrer" className="table-link">
                          Apply
                        </a>
                      ) : null}
                      {isSafeUrl(row.resume_pdf) ? (
                        <button
                          type="button"
                          onClick={() => api.openProtectedFile(row.resume_pdf)}
                          className="table-link"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          Resume
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td>{new Date(row.timestamp || row.scanned_at || Date.now()).toLocaleDateString('en-IN')}</td>
                </tr>
                {isExpanded ? (
                  <tr className="expand-row">
                    <td colSpan="9">
                      <div className="expand-panel">
                        <div>
                          <div className="mini-label">Fit Summary</div>
                          <p>{row.fit_summary || 'Summary unavailable for this row yet.'}</p>
                        </div>
                        <div>
                          <div className="mini-label">Strengths</div>
                          <div className="chip-row">
                            {(row.strengths || []).length ? row.strengths.map((item) => <span key={item} className="chip success">{item}</span>) : <span className="muted-copy">No strengths logged.</span>}
                          </div>
                        </div>
                        <div>
                          <div className="mini-label">Gaps</div>
                          <div className="chip-row">
                            {(row.gaps || []).length ? row.gaps.map((item) => <span key={item} className="chip danger">{item}</span>) : <span className="muted-copy">No gaps logged.</span>}
                          </div>
                        </div>
                        <div className="detail-grid">
                          <div>
                            <div className="mini-label">Interview Prep</div>
                            <ol className="number-list">
                              {(row.interview_prep || []).length ? row.interview_prep.map((item) => <li key={item}>{item}</li>) : <li>Interview prep not available.</li>}
                            </ol>
                          </div>
                          <div>
                            <div className="mini-label">Action Items</div>
                            <ul className="check-list">
                              {(row.action_items || []).length ? row.action_items.map((item) => <li key={item}>{item}</li>) : <li>Action items not available.</li>}
                            </ul>
                          </div>
                        </div>
                        <div>
                          <div className="mini-label">Negotiation Note</div>
                          <p>{row.negotiation_note || 'No negotiation note stored.'}</p>
                        </div>
                        <div>
                          <StatusBadge status={row.status} />
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
