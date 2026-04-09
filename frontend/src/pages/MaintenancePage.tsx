import { useEffect, useMemo, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { FleetItem, MaintenanceJob, MaintenanceRecommendation } from '../types/domain';

export function MaintenancePage() {
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [recommendation, setRecommendation] = useState<MaintenanceRecommendation | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    api.getFleet().then((r) => setFleet(r.fleet)).catch(console.error);
    api.listMaintenanceJobs().then((r) => setJobs(r.jobs)).catch(console.error);
  }, []);

  useRealtime({
    onFleetUpdate: (rows) => setFleet(rows),
  });

  useEffect(() => {
    const defaultId = selected || fleet[0]?.inverter_id;
    if (defaultId && !selected) {
      setSelected(defaultId);
    }
  }, [fleet, selected]);

  useEffect(() => {
    if (!selected) return;
    api.getMaintenanceRecommendation(selected).then(setRecommendation).catch(console.error);
  }, [selected]);

  const jobsByInverter = useMemo(() => {
    const map = new Map<string, MaintenanceJob>();
    jobs.forEach((job) => map.set(job.inverter_id, job));
    return map;
  }, [jobs]);

  const highRiskInverters = useMemo(
    () => fleet.filter((f) => f.status === 'critical' || f.predicted_rul_pct <= 25),
    [fleet]
  );

  const lanes = useMemo(() => ({
    unassigned: highRiskInverters.filter((f) => {
      const status = jobsByInverter.get(f.inverter_id)?.status || 'unassigned';
      return status === 'unassigned';
    }),
    planned: fleet.filter((f) => jobsByInverter.get(f.inverter_id)?.status === 'planned'),
    onsite: fleet.filter((f) => jobsByInverter.get(f.inverter_id)?.status === 'onsite'),
    completed: fleet.filter((f) => jobsByInverter.get(f.inverter_id)?.status === 'completed'),
  }), [fleet, highRiskInverters, jobsByInverter]);

  const selectedJob = selected ? jobsByInverter.get(selected) : null;
  const selectedStatus = selectedJob?.status || (highRiskInverters.find((f) => f.inverter_id === selected) ? 'unassigned' : 'unassigned');

  const createTicket = async (inverterId: string) => {
    setBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      await api.createServiceAlert({ inverter_id: inverterId });
      setActionMessage(`Service ticket created for ${inverterId}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to create service ticket.');
    } finally {
      setBusy(false);
    }
  };

  const refreshJobs = async () => {
    const jobsRes = await api.listMaintenanceJobs();
    setJobs(jobsRes.jobs);
  };

  const sendHelp = async (inverterId: string) => {
    setBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      const message = recommendation
        ? `${recommendation.recommendation.summary} ${recommendation.recommendation.actions.join(' ')}`
        : 'Please dispatch maintenance support.';
      await api.dispatchMaintenanceHelp({ inverter_id: inverterId, message });
      await refreshJobs();
      setActionMessage(`Maintenance help sent for ${inverterId}. Moved to planned.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to send maintenance help.');
    } finally {
      setBusy(false);
    }
  };

  const markOnSite = async (inverterId: string) => {
    setBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      await api.updateMaintenanceStatus(inverterId, 'onsite', 'Technician arrived on site');
      await refreshJobs();
      setActionMessage(`${inverterId} marked as on site.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to mark on site.');
    } finally {
      setBusy(false);
    }
  };

  const markCompleted = async (inverterId: string) => {
    setBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      await api.updateMaintenanceStatus(inverterId, 'completed', 'Service completed');
      await refreshJobs();
      setActionMessage(`${inverterId} marked as service completed.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to mark completed.');
    } finally {
      setBusy(false);
    }
  };

  const sendToMaintenance = async (inverterId: string) => {
    setBusy(true);
    setActionError('');
    setActionMessage('');
    try {
      const rec = await api.getMaintenanceRecommendation(inverterId);
      await api.sendCommunication({
        inverter_id: inverterId,
        to_role: 'maintenance_team',
        subject: `AI maintenance plan for ${inverterId}`,
        message: `${rec.recommendation.summary}\n- ${rec.recommendation.actions.join('\n- ')}`,
        severity: rec.recommendation.priority,
        channel: 'internal',
      });
      setActionMessage(`Maintenance dispatch sent for ${inverterId}.`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to dispatch plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="maintenance-page">
      <div className="surface-card maintenance-board">
        <div className="maintenance-board-header">
          <h3>Maintenance Command Board</h3>
          <p className="muted-text">Realtime lane grouping by risk and active tickets.</p>
        </div>
        <div className="maintenance-lanes">
          {Object.entries(lanes).map(([lane, items]) => (
            <div key={lane} className="maintenance-lane">
              <div className="maintenance-lane-head">
                <h4>{lane.toUpperCase()}</h4>
                <span className="lane-count">{items.length}</span>
              </div>
              <div className="lane-items scroll-list compact">
                {items.map((i) => (
                  <button className="kanban-card" key={i.inverter_id} onClick={() => setSelected(i.inverter_id)}>
                    <strong>{i.inverter_id}</strong>
                    <p>RUL: {i.predicted_rul_pct.toFixed(1)}% | Temp: {i.temp_c.toFixed(1)}C</p>
                    <p>Current: {i.current_rms.toFixed(1)}A | Cycles: {i.cycle_count.toLocaleString()}</p>
                    <span className={`status ${i.status}`}>{i.status}</span>
                    {lane === 'unassigned' && <button className="lane-action-btn" disabled={busy} onClick={(e) => { e.stopPropagation(); void sendHelp(i.inverter_id); }}>Send Help</button>}
                    {lane === 'planned' && <button className="lane-action-btn" disabled={busy} onClick={(e) => { e.stopPropagation(); void markOnSite(i.inverter_id); }}>Mark On Site</button>}
                    {lane === 'onsite' && <button className="lane-action-btn" disabled={busy} onClick={(e) => { e.stopPropagation(); void markCompleted(i.inverter_id); }}>Service Completed</button>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="surface-card maintenance-workbench">
        <h3>AI Maintenance Workbench {selected ? `| ${selected}` : ''}</h3>
        <div className="inline-actions">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {fleet.map((f) => (
              <option key={f.inverter_id} value={f.inverter_id}>
                {f.inverter_id} | RUL {f.predicted_rul_pct.toFixed(1)}%
              </option>
            ))}
          </select>
          <button className="ghost-btn" disabled={busy || !selected} onClick={() => selected && createTicket(selected)}>
            {busy ? 'Working...' : 'Create Service Ticket'}
          </button>
        </div>
        {actionMessage && <p className="success-note">{actionMessage}</p>}
        {actionError && <p className="login-error">{actionError}</p>}
        <p className="muted-text">Workflow Status: <span className={`status ${selectedStatus === 'completed' ? 'healthy' : selectedStatus === 'onsite' ? 'warning' : selectedStatus === 'planned' ? 'warning' : 'critical'}`}>{selectedStatus}</span></p>
        <div className="workspace-section">
          <p className="muted-text">{recommendation?.recommendation.summary || 'Select inverter from board to load recommendations.'}</p>
        </div>
        <div className="workspace-section">
          <ul className="action-list scroll-list compact">
            {(recommendation?.recommendation.actions || []).map((step) => <li key={step}>{step}</li>)}
          </ul>
        </div>
        <div className="button-row">
          <button className="primary-btn" disabled={!selected || busy || selectedStatus !== 'unassigned'} onClick={() => selected && sendHelp(selected)}>Send Help (Planned)</button>
          <button className="ghost-btn" disabled={!selected || busy || selectedStatus !== 'planned'} onClick={() => selected && markOnSite(selected)}>Mark On Site</button>
        </div>
        <div className="button-row">
          <button className="primary-btn" disabled={!selected || busy || selectedStatus !== 'onsite'} onClick={() => selected && markCompleted(selected)}>Service Completed</button>
          <button className="ghost-btn" disabled={!selected || busy} onClick={() => selected && sendToMaintenance(selected)}>Dispatch Plan</button>
        </div>
      </div>
    </div>
  );
}
