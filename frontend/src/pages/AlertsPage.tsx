import { useEffect, useMemo, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { FleetItem, ServiceAlert } from '../types/domain';

function classForLevel(level: string) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'critical') return 'critical';
  if (normalized === 'warning') return 'warning';
  if (normalized === 'medium') return 'medium';
  if (normalized === 'low') return 'healthy';
  return 'info';
}

export function AlertsPage() {
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [runtimeAlerts, setRuntimeAlerts] = useState<Array<{ inverter_id: string; level: string; message: string; ts: number }>>([]);

  useEffect(() => {
    api.listServiceAlerts(false, 80).then((r) => setAlerts(r.alerts)).catch(console.error);
    api.getFleet().then((r) => setFleet(r.fleet)).catch(console.error);
    api.listAlertEvents(120)
      .then((r) => {
        const mapped = [...r.events]
          .sort((a, b) => b.created_at - a.created_at)
          .map((e) => ({ inverter_id: e.inverter_id, level: e.level, message: e.message, ts: e.created_at }));
        setRuntimeAlerts(mapped);
      })
      .catch(console.error);
  }, []);

  const fleetById = useMemo(() => {
    const map = new Map<string, FleetItem>();
    fleet.forEach((f) => map.set(f.inverter_id, f));
    return map;
  }, [fleet]);

  useRealtime({
    onFleetUpdate: (rows) => setFleet(rows),
    onAlert: (event) => {
      setRuntimeAlerts((prev) => [event, ...prev].slice(0, 20));
    },
    onServiceAlertNew: (alert) => {
      setAlerts((prev) => [alert, ...prev.filter((a) => a.id !== alert.id)].slice(0, 30));
    },
    onServiceAlertAck: ({ id }) => {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: 1 } : a)));
    },
  });

  const ack = async (id: number) => {
    await api.ackServiceAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: 1 } : a)));
  };

  const sendQuickNotice = async (inverterId: string) => {
    const latest = fleetById.get(inverterId);
    await api.sendCommunication({
      inverter_id: inverterId,
      to_role: 'customer_user',
      subject: `Alert advisory for ${inverterId}`,
      message: latest
        ? `Current state: RUL ${latest.predicted_rul_pct.toFixed(1)}%, Temp ${latest.temp_c.toFixed(1)}C, Current ${latest.current_rms.toFixed(1)}A. Please schedule maintenance.`
        : 'Predictive alert active. Please schedule maintenance.',
      severity: latest?.status === 'critical' ? 'critical' : 'medium',
      channel: 'email',
    });
  };

  return (
    <div className="grid-two">
      <div className="surface-card">
        <h3>Live Runtime Alerts</h3>
        <ul className="action-list">
          {runtimeAlerts.length === 0 && <li>No live events yet. Alerts will stream in realtime.</li>}
          {runtimeAlerts.map((event) => (
            <li key={`${event.inverter_id}-${event.ts}`}>
              <span className={`status ${classForLevel(event.level)}`}>{event.level}</span>{' '}
              {event.inverter_id} | {event.message}
            </li>
          ))}
        </ul>
      </div>

      <div className="surface-card">
        <h3>AI Service Alert Queue</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Inverter</th><th>Priority</th><th>RUL</th><th>Temp</th><th>Current</th><th>Cycles</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => {
              const latest = fleetById.get(a.inverter_id);
              return (
                <tr key={a.id}>
                  <td>{a.inverter_id}</td>
                  <td><span className={`status ${classForLevel(a.priority)}`}>{a.priority}</span></td>
                  <td>{a.rul_pct.toFixed(1)}%</td>
                  <td>{a.temp_c.toFixed(1)}°C</td>
                  <td>{latest ? `${latest.current_rms.toFixed(1)}A` : '-'}</td>
                  <td>{latest ? latest.cycle_count.toLocaleString() : '-'}</td>
                  <td className="table-actions-cell">
                    <button className="ghost-btn" onClick={() => sendQuickNotice(a.inverter_id)}>Notify User</button>
                    <button className="ghost-btn" onClick={() => ack(a.id)} disabled={a.acknowledged === 1}>
                      {a.acknowledged === 1 ? 'Acknowledged' : 'Acknowledge'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
