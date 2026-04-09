import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { FleetItem } from '../types/domain';

const statusColors = {
  healthy: '#3dd9a7',
  warning: '#ffbe55',
  critical: '#ff5b7f',
};

export function DashboardPage() {
  const [fleet, setFleet] = useState<FleetItem[]>([]);

  useEffect(() => {
    api.getFleet().then((r) => setFleet(r.fleet)).catch(console.error);
  }, []);

  useRealtime({
    onFleetUpdate: (rows) => setFleet(rows),
  });

  const kpis = useMemo(() => {
    const total = fleet.length;
    const critical = fleet.filter((f) => f.status === 'critical').length;
    const avgRul = total ? fleet.reduce((s, f) => s + f.predicted_rul_pct, 0) / total : 0;
    const due = fleet.filter((f) => f.predicted_rul_pct < 35).length;
    return { total, critical, avgRul, due };
  }, [fleet]);

  const distribution = useMemo(() => {
    return ['healthy', 'warning', 'critical'].map((key) => ({
      name: key,
      value: fleet.filter((f) => f.status === key).length,
      color: statusColors[key as keyof typeof statusColors],
    }));
  }, [fleet]);

  return (
    <div className="page-grid">
      <section className="dashboard-brand-card">
        <img src="/reguar-logo.svg" alt="Reguar" className="dashboard-brand-logo" />
        <div>
          <p className="dashboard-eyebrow">Reguar</p>
          <h1 className="dashboard-brand-title">Command Dashboard</h1>
          <p className="dashboard-brand-subtitle">
            Real-time predictive maintenance command center for inverter operations.
          </p>
        </div>
      </section>

      <div className="kpi-grid">
        <div className="kpi-card"><p>Total Inverters</p><h3>{kpis.total}</h3></div>
        <div className="kpi-card"><p>Critical Alerts</p><h3>{kpis.critical}</h3></div>
        <div className="kpi-card"><p>Avg RUL</p><h3>{kpis.avgRul.toFixed(1)}%</h3></div>
        <div className="kpi-card"><p>Due Maintenance</p><h3>{kpis.due}</h3></div>
      </div>

      <div className="grid-two">
        <div className="surface-card large">
          <h4>System Power & Thermal Flux</h4>
          <div className="chart-wrap">
            <ResponsiveContainer>
              <BarChart data={fleet.map((f) => ({ id: f.inverter_id, temp: f.temp_c, load: f.load_pct }))}>
                <XAxis dataKey="id" tick={{ fill: '#8ea7ca', fontSize: 11 }} />
                <YAxis tick={{ fill: '#8ea7ca', fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="temp" fill="#57a5ff" radius={[6, 6, 0, 0]} />
                <Bar dataKey="load" fill="#3dd9a7" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="stack-col">
          <div className="surface-card">
            <h4>Fleet Health Distribution</h4>
            <div className="chart-wrap small">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={distribution} dataKey="value" nameKey="name" innerRadius={55} outerRadius={76}>
                    {distribution.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="surface-card">
            <h4>Top At Risk Inverters</h4>
            <table className="mini-table">
              <thead><tr><th>ID</th><th>RUL</th><th>Temp</th><th>Current</th><th>Cycles</th><th>Status</th></tr></thead>
              <tbody>
                {[...fleet].sort((a, b) => a.predicted_rul_pct - b.predicted_rul_pct).slice(0, 5).map((f) => (
                  <tr key={f.inverter_id}>
                    <td>{f.inverter_id}</td>
                    <td>{f.predicted_rul_pct.toFixed(1)}%</td>
                    <td>{f.temp_c.toFixed(1)}C</td>
                    <td>{f.current_rms.toFixed(1)}A</td>
                    <td>{f.cycle_count.toLocaleString()}</td>
                    <td><span className={`status ${f.status}`}>{f.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
