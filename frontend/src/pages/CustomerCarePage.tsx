import { useEffect, useMemo, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { Communication, FleetItem, MaintenanceRecommendation, ServiceAlert } from '../types/domain';

export function CustomerCarePage() {
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [selected, setSelected] = useState('INV-001');
  const [message, setMessage] = useState('Please plan preventive maintenance as soon as possible.');
  const [maintenance, setMaintenance] = useState<MaintenanceRecommendation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listServiceAlerts().then((r) => {
      setAlerts(r.alerts);
      if (r.alerts[0]) setSelected(r.alerts[0].inverter_id);
    }).catch(console.error);
    api.getFleet().then((r) => {
      setFleet(r.fleet);
      if (!alerts.length && r.fleet[0]) {
        setSelected(r.fleet[0].inverter_id);
      }
    }).catch(console.error);
    api.listCommunications().then((r) => setCommunications(r.communications)).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selected) return;
    api.getMaintenanceRecommendation(selected)
      .then((data) => {
        setMaintenance(data);
        setMessage(`${data.recommendation.summary}\n- ${data.recommendation.actions.join('\n- ')}`);
      })
      .catch(console.error);
  }, [selected]);

  const selectedFleet = useMemo(() => fleet.find((f) => f.inverter_id === selected) || null, [fleet, selected]);
  const selectedAlert = useMemo(() => alerts.find((a) => a.inverter_id === selected) || null, [alerts, selected]);

  useRealtime({
    onFleetUpdate: (rows) => setFleet(rows),
    onServiceAlertNew: (alert) => {
      setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 30));
    },
    onServiceAlertAck: ({ id }) => {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    },
    onCommunicationNew: (communication) => {
      setCommunications((prev) => [communication, ...prev.filter((c) => c.id !== communication.id)].slice(0, 30));
    },
    onCommunicationAck: ({ id }) => {
      setCommunications((prev) => prev.filter((c) => c.id !== id));
    },
  });

  const send = async (to: 'customer_user' | 'maintenance_team') => {
    setBusy(true);
    await api.sendCommunication({
      inverter_id: selected,
      to_role: to,
      subject: `Update for ${selected}`,
      message,
      severity: maintenance?.recommendation.priority || 'medium',
      channel: to === 'customer_user' ? 'email' : 'internal',
    });
    const next = await api.listCommunications();
    setCommunications(next.communications);
    setBusy(false);
  };

  const escalateToAiTicket = async () => {
    if (!selected) return;
    setBusy(true);
    await api.createServiceAlert({ inverter_id: selected });
    const [alertsNext, commsNext] = await Promise.all([api.listServiceAlerts(), api.listCommunications()]);
    setAlerts(alertsNext.alerts);
    setCommunications(commsNext.communications);
    setBusy(false);
  };

  const ackSelectedTicket = async () => {
    if (!selectedAlert) return;
    setBusy(true);
    await api.ackServiceAlert(selectedAlert.id);
    setAlerts((prev) => prev.filter((a) => a.id !== selectedAlert.id));
    setBusy(false);
  };

  return (
    <div className="customer-care-page">
      <div className="surface-card customer-care-queue">
        <h3>Ticket Queue</h3>
        <div className="ticket-list scroll-list">
          {(alerts.length ? alerts : fleet.map((f) => ({ id: Number(f.ts), inverter_id: f.inverter_id, recommended_action: `RUL ${f.predicted_rul_pct.toFixed(1)}%, Temp ${f.temp_c.toFixed(1)}C`, priority: f.status, created_at: f.ts, rul_pct: f.predicted_rul_pct, temp_c: f.temp_c, status: f.status, customer_contact: null, context_mode: 'simulation', acknowledged: 0 }))).map((a) => (
            <button key={a.id} className={`ticket-item ${selected === a.inverter_id ? 'selected' : ''}`} onClick={() => setSelected(a.inverter_id)}>
              <strong>{a.inverter_id}</strong>
              <span>{a.recommended_action.slice(0, 72)}...</span>
            </button>
          ))}
        </div>
      </div>

      <div className="surface-card customer-care-workspace">
        <h3>AI Customer Care Workspace</h3>
        <div className="kpi-grid compact">
          <div className="kpi-card"><p>RUL</p><h3>{selectedFleet ? `${selectedFleet.predicted_rul_pct.toFixed(1)}%` : '-'}</h3></div>
          <div className="kpi-card"><p>Temp / Current</p><h3>{selectedFleet ? `${selectedFleet.temp_c.toFixed(1)}C / ${selectedFleet.current_rms.toFixed(1)}A` : '-'}</h3></div>
          <div className="kpi-card"><p>Cycles</p><h3>{selectedFleet ? selectedFleet.cycle_count.toLocaleString() : '-'}</h3></div>
        </div>
        <div className="workspace-section">
          <p className="muted-text">Priority tip: {maintenance?.recommendation.summary || 'Select an inverter to generate AI tips.'}</p>
        </div>
        <div className="workspace-section">
          <textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
        <div className="inline-actions">
          <button className="ghost-btn" onClick={escalateToAiTicket} disabled={busy}>Generate AI Ticket</button>
          <button className="ghost-btn" onClick={ackSelectedTicket} disabled={busy || !selectedAlert}>Close Ticket</button>
        </div>
        <div className="button-row">
          <button className="primary-btn" onClick={() => send('customer_user')} disabled={busy}>Send To Customer</button>
          <button className="ghost-btn" onClick={() => send('maintenance_team')} disabled={busy}>Send To Maintenance</button>
        </div>
        <div className="workspace-section">
          <h4>Recent Communications</h4>
          <ul className="action-list scroll-list compact">
            {communications.slice(0, 8).map((c) => <li key={c.id}>{c.to_role}: {c.subject}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}
