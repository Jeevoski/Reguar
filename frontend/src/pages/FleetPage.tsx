import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { FleetItem, HealthStatus } from '../types/domain';

export function FleetPage() {
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | HealthStatus>('all');
  const [newInverterId, setNewInverterId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');

  useEffect(() => {
    api.getFleet().then((r) => setFleet(r.fleet)).catch(console.error);
  }, []);

  useRealtime({
    onFleetUpdate: (rows) => setFleet(rows),
  });

  const filtered = useMemo(
    () => fleet.filter((f) => (status === 'all' || f.status === status) && f.inverter_id.toLowerCase().includes(q.toLowerCase())),
    [fleet, q, status]
  );

  const addInverter = async () => {
    setAdding(true);
    setAddError('');
    try {
      await api.addInverter(newInverterId ? { inverter_id: newInverterId } : undefined);
      setNewInverterId('');
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add inverter');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="surface-card">
      <div className="table-toolbar">
        <input placeholder="Search inverter..." value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | HealthStatus)}>
          <option value="all">All</option>
          <option value="healthy">Healthy</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>
      <div className="inline-actions">
        <input
          placeholder="New inverter ID (optional, ex: INV-009)"
          value={newInverterId}
          onChange={(e) => setNewInverterId(e.target.value.toUpperCase())}
        />
        <button className="primary-btn" onClick={addInverter} disabled={adding}>{adding ? 'Adding...' : 'Add Inverter'}</button>
      </div>
      {addError && <p className="login-error">{addError}</p>}
      <table className="data-table">
        <thead>
          <tr>
            <th>Inverter</th><th>Status</th><th>Predicted RUL</th><th>Temp</th><th>Current</th><th>Voltage</th><th>Humidity</th><th>Cycles</th><th>Load</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((f) => (
            <tr key={f.inverter_id}>
              <td>{f.inverter_id}</td>
              <td><span className={`status ${f.status}`}>{f.status}</span></td>
              <td>{f.predicted_rul_pct.toFixed(1)}%</td>
              <td>{f.temp_c.toFixed(1)}°C</td>
              <td>{f.current_rms.toFixed(1)}A</td>
              <td>{f.voltage_rms.toFixed(1)}V</td>
              <td>{f.humidity_pct.toFixed(1)}%</td>
              <td>{f.cycle_count.toLocaleString()}</td>
              <td>{f.load_pct.toFixed(1)}%</td>
              <td><Link className="link-btn" to={`/inverters/${f.inverter_id}`}>Inspect</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
