import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export default function LoadingBar() {
  const backgroundTask = useAppStore((state) => state.backgroundTask);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (backgroundTask) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), 250);
    return () => window.clearTimeout(timer);
  }, [backgroundTask]);

  if (!visible) return null;

  return (
    <div className={`loading-shell ${backgroundTask ? 'active' : 'finishing'}`} aria-live="polite">
      <div className="loading-bar" />
      <div className="loading-label">{backgroundTask?.label || 'Wrapping up...'}</div>
    </div>
  );
}
