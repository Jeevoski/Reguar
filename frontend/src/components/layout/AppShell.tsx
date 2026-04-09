import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useRealtime } from '../../hooks/useRealtime';
import type { SourceState } from '../../types/domain';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  const [source, setSource] = useState<SourceState | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useRealtime({
    onSourceUpdate: (payload) => setSource(payload),
  });

  return (
    <div className="app-root">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      {sidebarOpen && <button className="sidebar-overlay" aria-label="close navigation overlay" onClick={() => setSidebarOpen(false)} />}
      <main className="main-wrap">
        <Topbar source={source} onOpenSidebar={() => setSidebarOpen(true)} />
        <section className="page-wrap">
          <Outlet />
        </section>
      </main>
    </div>
  );
}
