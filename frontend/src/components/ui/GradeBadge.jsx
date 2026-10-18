export default function GradeBadge({ grade }) {
  return <span className={`grade-badge grade-${grade || 'unknown'}`}>{grade || 'N/A'}</span>;
}
