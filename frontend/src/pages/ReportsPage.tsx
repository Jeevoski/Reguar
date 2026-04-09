import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { FleetItem, MaintenanceRecommendation, ModelStats, SourceState, TelemetryPoint } from '../types/domain';

export function ReportsPage() {
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecommendation | null>(null);
  const [model, setModel] = useState<ModelStats | null>(null);
  const [source, setSource] = useState<SourceState | null>(null);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    api.getFleet().then((r) => {
      setFleet(r.fleet);
      if (r.fleet[0]) {
        setSelected(r.fleet[0].inverter_id);
      }
    }).catch(console.error);
  }, []);

  useRealtime({
    onFleetUpdate: (rows) => setFleet(rows),
  });

  const stats = useMemo(() => {
    const avgHealth = fleet.length ? fleet.reduce((s, f) => s + f.predicted_rul_pct, 0) / fleet.length : 0;
    return {
      avgHealth,
      critical: fleet.filter((f) => f.status === 'critical').length,
      warnings: fleet.filter((f) => f.status === 'warning').length,
    };
  }, [fleet]);

  const selectedFleet = useMemo(() => fleet.find((f) => f.inverter_id === selected) || null, [fleet, selected]);

  const collectReport = async () => {
    if (!selected) return;
    setCollecting(true);
    const [historyRes, maintenanceRes, modelRes, sourceRes] = await Promise.all([
      api.getHistory(selected, 180),
      api.getMaintenanceRecommendation(selected),
      api.getModelMetrics(),
      api.getSource(),
    ]);
    setHistory(historyRes.history);
    setMaintenance(maintenanceRes);
    setModel(modelRes);
    setSource(sourceRes);
    setCollecting(false);
  };

  const exportJson = () => {
    const payload = {
      inverter: selected,
      collectedAt: new Date().toISOString(),
      snapshot: selectedFleet,
      source,
      model,
      maintenance,
      history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected || 'inverter'}-report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const rows = history.map((h) => [
      h.ts,
      h.inverter_id,
      h.predicted_rul_pct,
      h.temp_c,
      h.current_rms,
      h.voltage_rms,
      h.humidity_pct,
      h.cycle_count,
      h.status,
    ]);
    const csv = [
      'ts,inverter_id,predicted_rul_pct,temp_c,current_rms,voltage_rms,humidity_pct,cycle_count,status',
      ...rows.map((r) => r.join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected || 'inverter'}-telemetry.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid-three">
      <div className="surface-card">
        <h3>Reports & Analytics</h3>
        <div className="kpi-grid compact">
          <div className="kpi-card"><p>Fleet Health Index</p><h3>{stats.avgHealth.toFixed(1)}%</h3></div>
          <div className="kpi-card"><p>Critical Alerts</p><h3>{stats.critical}</h3></div>
          <div className="kpi-card"><p>Warning Alerts</p><h3>{stats.warnings}</h3></div>
        </div>
      </div>
      <div className="surface-card">
        <h3>Historical Failure Rate</h3>
        <div className="chart-wrap small">
          <ResponsiveContainer>
            <BarChart data={fleet.map((f) => ({ id: f.inverter_id, risk: 100 - f.predicted_rul_pct }))}>
              <XAxis dataKey="id" tick={{ fill: '#8ea7ca', fontSize: 10 }} />
              <YAxis tick={{ fill: '#8ea7ca', fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="risk" fill="#5ea8ff" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="surface-card">
        <h3>Per-Inverter Data Collection</h3>
        <div className="inline-actions">
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {fleet.map((f) => <option key={f.inverter_id} value={f.inverter_id}>{f.inverter_id}</option>)}
          </select>
          <button className="primary-btn" onClick={collectReport} disabled={collecting || !selected}>{collecting ? 'Collecting...' : 'Collect Report'}</button>
        </div>
        {selectedFleet && (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <tbody>
                <tr><th>RUL</th><td>{selectedFleet.predicted_rul_pct.toFixed(1)}%</td></tr>
                <tr><th>Temp</th><td>{selectedFleet.temp_c.toFixed(1)}C</td></tr>
                <tr><th>Current</th><td>{selectedFleet.current_rms.toFixed(1)}A</td></tr>
                <tr><th>Voltage</th><td>{selectedFleet.voltage_rms.toFixed(1)}V</td></tr>
                <tr><th>Humidity</th><td>{selectedFleet.humidity_pct.toFixed(1)}%</td></tr>
                <tr><th>Cycles</th><td>{selectedFleet.cycle_count.toLocaleString()}</td></tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="muted-text">AI Tip: {maintenance?.recommendation.summary || 'Collect report to load AI summary.'}</p>
        <div className="button-row">
          <button className="ghost-btn" onClick={exportJson} disabled={!history.length}>Download JSON</button>
          <button className="ghost-btn" onClick={exportCsv} disabled={!history.length}>Download CSV</button>
        </div>
      </div>
    </div>
  );
}
