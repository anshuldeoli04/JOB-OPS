export default function EmptyState({ title, body, action }) {
  return (
    <div className="empty-state-card">
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}
