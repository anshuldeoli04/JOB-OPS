export default function ScoreBar({ score = 0 }) {
  const color = score >= 8 ? 'var(--grade-a)' : score >= 6 ? 'var(--grade-b)' : score >= 4 ? 'var(--grade-c)' : 'var(--grade-f)';
  return (
    <div className="score-row">
      <span className="score-mono" style={{ color }}>
        {Number(score).toFixed(1)}
      </span>
      <div className="score-bar">
        <div className="score-fill" style={{ width: `${Math.max(0, Math.min(100, score * 10))}%`, background: color }} />
      </div>
    </div>
  );
}
