import { Bell, Gauge, ListChecks, ScanSearch, Settings, Sparkles, FileText, UserCircle2, ShieldCheck } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';

const links = [
  { to: '/', label: 'Dashboard', icon: Gauge },
  { to: '/applications', label: 'Applications', icon: ListChecks },
  { to: '/scanner', label: 'Scanner', icon: ScanSearch },
  { to: '/evaluate', label: 'Evaluate', icon: Sparkles },
  { to: '/resume', label: 'Resume Builder', icon: FileText },
  { to: '/operations', label: 'Operations', icon: ShieldCheck },
  { to: '/settings', label: 'Settings', icon: Settings }
];

export default function Sidebar() {
  const applications = useAppStore((state) => state.applications);
  const session = useAppStore((state) => state.session);
  const gradeAOpen = applications.filter((item) => item.grade === 'A' && item.status === 'evaluated').length;

  return (
    <aside className="sidebar">
      <div>
        <div className="sidebar-logo">
          <div className="brand-mark">JOB-OPS</div>
          <div className="muted-copy">Operator Panel</div>
        </div>

        <nav className="sidebar-nav">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={18} />
              <span>{label}</span>
              {label === 'Applications' && gradeAOpen > 0 ? <span className="badge-dot">{gradeAOpen}</span> : null}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="sidebar-footer">
        <div className="profile-chip">
          <UserCircle2 size={18} />
          <div>
            <strong>{session?.name || 'Guest'}</strong>
            <span>{session?.experienceLevel || 'fresher'}</span>
          </div>
        </div>
        <div className="sidebar-status">
          <Bell size={14} />
          <span>Alerts armed</span>
        </div>
      </div>
    </aside>
  );
}
