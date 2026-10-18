import { Search, Clock3, LogOut } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

export default function Header() {
  const navigate = useNavigate();
  const scanResults = useAppStore((state) => state.scanResults);
  const logout = useAppStore((state) => state.logout);
  const setShortcutFocus = useAppStore((state) => state.setShortcutFocus);

  const lastScan = useMemo(() => {
    const latest = [...scanResults].sort(
      (a, b) => new Date(b.scanned_at || b.posted || 0).getTime() - new Date(a.scanned_at || a.posted || 0).getTime()
    )[0];
    if (!latest) return 'No scans yet';
    return new Date(latest.scanned_at || latest.posted).toLocaleString('en-IN');
  }, [scanResults]);

  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">JOB-OPS Workspace</div>
        <h2>Frontend control room</h2>
      </div>

      <button className="search-trigger" type="button" onClick={() => setShortcutFocus('global-search')}>
        <Search size={16} />
        <span>Global Search</span>
        <kbd>Ctrl+K</kbd>
      </button>

      <div className="topbar-meta">
        <div className="scan-badge">
          <Clock3 size={14} />
          <span>Last scan: {lastScan}</span>
        </div>
        <button
          className="ghost-button"
          type="button"
          onClick={async () => {
            await logout();
            navigate('/auth/login');
          }}
        >
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
