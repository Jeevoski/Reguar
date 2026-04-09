import { Bell, Clock3, Menu } from 'lucide-react';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { SourceState } from '../../types/domain';

const titleMap: Record<string, string> = {
  '/dashboard': 'Reguar Command Dashboard',
  '/fleet': 'Fleet Intelligence',
  '/alerts': 'Alerts & Incidents',
  '/customer-care': 'Customer Care Workspace',
  '/maintenance': 'Maintenance Board',
  '/reports': 'Reports & Analytics',
  '/settings': 'System Orchestration',
};

export function Topbar({ source, onOpenSidebar }: { source: SourceState | null; onOpenSidebar: () => void }) {
  const location = useLocation();
  const title = useMemo(() => titleMap[location.pathname] ?? 'Reguar', [location.pathname]);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" aria-label="open navigation menu" onClick={onOpenSidebar}>
          <Menu size={16} />
        </button>
        <h2>{title}</h2>
      </div>
      <div className="topbar-right">
        <div className="status-pills">
          <span className="pill">{source?.mode === 'hardware' ? 'HARDWARE MODE' : 'SIM MODE'}</span>
          <span className="pill muted">{source?.simulationEnabled === false ? 'STREAM PAUSED' : 'STREAM RUNNING'}</span>
        </div>
        <div className="clock-chip">
          <Clock3 size={14} />
          <span>{new Date().toLocaleTimeString()}</span>
        </div>
        <button className="icon-btn" aria-label="notifications">
          <Bell size={16} />
          <span className="badge-dot" />
        </button>
      </div>
    </header>
  );
}
