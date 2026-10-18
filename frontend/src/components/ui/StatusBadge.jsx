export default function StatusBadge({ status }) {
  return <span className={`status-badge status-${status || 'evaluated'}`}>{status || 'evaluated'}</span>;
}
