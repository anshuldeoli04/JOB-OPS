import { isScanTableLine } from '../../utils/scanFormatting';

export default function Terminal({
  logs = [],
  status = 'idle',
  title = 'bridge://scanner-stream',
  idleMessage = 'Scanner idle. Start a run to watch live output here.'
}) {
  return (
    <div className="terminal-shell" aria-live="polite">
      <div className="terminal-head">
        <span className="dot red" />
        <span className="dot amber" />
        <span className="dot green" />
        <strong>{title}</strong>
        <span className={`terminal-status ${status}`}>{status}</span>
      </div>
      <div className="terminal-body">
        {logs.length ? (
          logs.map((log, index) => (
            <div key={`${log}-${index}`} className="terminal-line">
              <span className="terminal-prompt">$</span>
              <span className={isScanTableLine(log) ? 'terminal-text terminal-text-table' : 'terminal-text'}>{log}</span>
            </div>
          ))
        ) : (
          <div className="terminal-line">
            <span className="terminal-prompt">$</span>
            <span className="terminal-text">{idleMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}
