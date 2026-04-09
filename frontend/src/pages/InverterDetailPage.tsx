import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { MaintenanceRecommendation, TelemetryPoint } from '../types/domain';

export function InverterDetailPage() {
  const { id = 'INV-001' } = useParams();
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceRecommendation | null>(null);

  useEffect(() => {
    api.getHistory(id, 120).then((r) => setHistory(r.history)).catch(console.error);
    api.getMaintenanceRecommendation(id).then(setMaintenance).catch(console.error);
  }, [id]);

  useRealtime({
    onTelemetryUpdate: (payload) => {
      if (payload.inverter_id !== id) {
        return;
      }
      setHistory((prev) => [...prev.slice(-119), payload.point]);
    },
  });

  return (
    <div className="grid-two">
      <div className="surface-card large">
        <h3>{id}</h3>
        <p className="muted-text">Live Telemetry</p>
        <div className="chart-wrap">
          <ResponsiveContainer>
            <LineChart data={history.map((h) => ({ t: new Date(h.ts).toLocaleTimeString(), v: h.voltage_rms, c: h.current_rms, temp: h.temp_c }))}>
              <XAxis dataKey="t" tick={{ fill: '#8ea7ca', fontSize: 10 }} interval={12} />
              <YAxis tick={{ fill: '#8ea7ca', fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="v" stroke="#58a8ff" dot={false} />
              <Line type="monotone" dataKey="c" stroke="#f59e0b" dot={false} />
              <Line type="monotone" dataKey="temp" stroke="#ff617d" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="surface-card">
        <h4>Predictive Maintenance</h4>
        <p>{maintenance?.recommendation.summary || 'Loading recommendations...'}</p>
        <ul className="action-list">
          {(maintenance?.recommendation.actions || []).map((a) => <li key={a}>{a}</li>)}
        </ul>
      </div>
    </div>
  );
}
