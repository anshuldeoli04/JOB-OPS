import { useState } from 'react';
import Panel from '../components/ui/Panel';
import Terminal from '../components/ui/Terminal';
import EmptyState from '../components/ui/EmptyState';
import { useAppStore } from '../store/useAppStore';
import { buildVisibleScanRows, getScanResultLimit, truncateText } from '../utils/scanFormatting';

const sourceOptions = ['greenhouse', 'lever', 'internshala', 'naukri', 'wellfound'];

function isSafeUrl(url) {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim().toLowerCase();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/');
}

export default function Scanner() {
  const config = useAppStore((state) => state.config);
  const scanResults = useAppStore((state) => state.scanResults);
  const activeScan = useAppStore((state) => state.activeScan);
  const runScan = useAppStore((state) => state.runScan);
  const [sources, setSources] = useState(['greenhouse', 'lever', 'wellfound']);
  const [keywords, setKeywords] = useState((config?.target_roles || []).join(', '));
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const totalPages = Math.ceil(scanResults.length / pageSize) || 1;
  const visibleRows = buildVisibleScanRows(scanResults, page, pageSize);

  return (
    <div className="two-up-grid">
      <Panel title="Scan config" subtitle="Source selection + keyword controls">
        <div className="stack-gap">
          <div className="checkbox-grid">
            {sourceOptions.map((source) => (
              <label key={source} className="check-chip">
                <input
                  type="checkbox"
                  checked={sources.includes(source)}
                  onChange={(e) =>
                    setSources((prev) =>
                      e.target.checked ? [...prev, source] : prev.filter((item) => item !== source)
                    )
                  }
                />
                <span>{source}</span>
              </label>
            ))}
          </div>
          <label>
            Keywords
            <textarea
              className="text-area"
              rows="5"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </label>
          <div className="toolbar-inline">
            <button className="primary-button" type="button" onClick={() => runScan({ mode: 'scan', sources, keywords })}>
              Run Scan
            </button>
            <button className="secondary-button" type="button" onClick={() => runScan({ mode: 'autoflow', sources, keywords })}>
              Scan + Evaluate
            </button>
          </div>
        </div>
      </Panel>

      <Panel title="Live terminal output" subtitle="SSE-ready terminal panel">
        <Terminal logs={activeScan.logs} status={activeScan.status} />
      </Panel>

      <Panel title="Scan results" subtitle="Structured scan table with aligned columns and recent-first focus" className="full-span">
        {scanResults.length ? (
          <div className="scan-results-shell">
            <div className="scan-results-table-wrap">
              <table className="scan-results-table">
                <thead>
                  <tr>
                    <th>S.No</th>
                    <th>Company</th>
                    <th>Title</th>
                    <th>Source</th>
                    <th>Location</th>
                    <th>Date</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((item) => (
                    <tr key={`${item.company}-${item.role}-${item.url}`}>
                      <td className="scan-col-index">{item.displayIndex}</td>
                      <td className="scan-col-company">
                        <span className="scan-cell-strong" title={item.displayCompany}>
                          {truncateText(item.displayCompany, 32)}
                        </span>
                      </td>
                      <td className="scan-col-title">
                        <span className="scan-cell-truncate" title={item.displayTitle}>
                          {truncateText(item.displayTitle, 68)}
                        </span>
                      </td>
                      <td className="scan-col-source">
                        <span className="chip neutral">{item.displaySource}</span>
                      </td>
                      <td className="scan-col-location">
                        <span className="scan-cell-truncate" title={item.displayLocation}>
                          {truncateText(item.displayLocation, 28)}
                        </span>
                      </td>
                      <td className="scan-col-date">{item.displayDate}</td>
                      <td className="scan-col-action">
                        {isSafeUrl(item.url) ? (
                          <a href={item.url} target="_blank" rel="noreferrer" className="table-link">Open</a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="scan-results-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Showing {visibleRows.length} of {scanResults.length} jobs (Page {page} of {totalPages})</span>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{page} / {totalPages}</span>
                <button
                  type="button"
                  className="secondary-button"
                  style={{ padding: '4px 10px', fontSize: '0.85rem' }}
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="Scanner not run yet" body="Bridge server is ready. Scan jobs to stream live results here." />
        )}
      </Panel>
    </div>
  );
}
