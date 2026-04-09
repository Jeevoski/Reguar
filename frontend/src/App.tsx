import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AlertsPage } from './pages/AlertsPage';
import { CustomerCarePage } from './pages/CustomerCarePage';
import { DashboardPage } from './pages/DashboardPage';
import { FleetPage } from './pages/FleetPage';
import { InverterDetailPage } from './pages/InverterDetailPage';
import { LoginPage } from './pages/LoginPage';
import { MaintenancePage } from './pages/MaintenancePage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';

function AnimatedPage({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

function NotFound() {
  return (
    <div className="surface-card">
      <h3>Page Not Found</h3>
      <p>The requested module has not been mapped to a route.</p>
    </div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<Navigate to="/login" replace />} />

        <Route path="/" element={<AppShell />}>
          <Route path="dashboard" element={<AnimatedPage><DashboardPage /></AnimatedPage>} />
          <Route path="fleet" element={<AnimatedPage><FleetPage /></AnimatedPage>} />
          <Route path="inverters/:id" element={<AnimatedPage><InverterDetailPage /></AnimatedPage>} />
          <Route path="alerts" element={<AnimatedPage><AlertsPage /></AnimatedPage>} />
          <Route path="customer-care" element={<AnimatedPage><CustomerCarePage /></AnimatedPage>} />
          <Route path="maintenance" element={<AnimatedPage><MaintenancePage /></AnimatedPage>} />
          <Route path="reports" element={<AnimatedPage><ReportsPage /></AnimatedPage>} />
          <Route path="settings" element={<AnimatedPage><SettingsPage /></AnimatedPage>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}
