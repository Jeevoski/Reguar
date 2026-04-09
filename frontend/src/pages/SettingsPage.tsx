import { useEffect, useState } from 'react';
import { useRealtime } from '../hooks/useRealtime';
import { api } from '../services/api';
import type { ModelStats, RealtimeRulPoint, SensorConnection, SourceState } from '../types/domain';

export function SettingsPage() {
  const [source, setSource] = useState<SourceState | null>(null);
  const [speed, setSpeed] = useState(1);
  const [model, setModel] = useState<ModelStats | null>(null);
  const [samples, setSamples] = useState(30000);
  const [training, setTraining] = useState(false);
  const [inverters, setInverters] = useState<string[]>([]);
  const [selectedInverter, setSelectedInverter] = useState('INV-001');
  const [sensorStatus, setSensorStatus] = useState<SensorConnection[]>([]);
  const [latestRul, setLatestRul] = useState<RealtimeRulPoint | null>(null);
  const [sensorBusy, setSensorBusy] = useState(false);

  useEffect(() => {
    api.getSource().then((r) => {
      setSource(r);
      setSpeed(r.speedMultiplier);
    }).catch(console.error);
    api.getModelMetrics().then(setModel).catch(console.error);
    api.listInverters().then((r) => {
      setInverters(r.inverters);
      if (r.inverters.length) {
        setSelectedInverter(r.inverters[0]);
      }
    }).catch(console.error);
    api.listSensorStatus().then((r) => setSensorStatus(r.sensors)).catch(console.error);
  }, []);

  useRealtime({
    onSourceUpdate: (payload) => {
      setSource(payload);
      setSpeed(payload.speedMultiplier);
    },
    onSensorStatus: (payload) => {
      setSensorStatus((prev) => {
        const next = prev.filter((s) => s.inverter_id !== payload.inverter_id);
        next.unshift(payload);
        return next.slice(0, 12);
      });
    },
    onRulUpdate: (payload) => {
      if (payload.inverter_id === selectedInverter) {
        setLatestRul(payload);
      }
    },
  });

  const connectSensor = async () => {
    setSensorBusy(true);
    try {
      await api.connectSensor({
        inverter_id: selectedInverter,
        adapter_mode: source?.hardwareAdapterMode || 'stub',
        transport: 'modbus+gpio',
        firmware: 'gateway-0.1',
        metadata: { host: 'raspberry-pi', ready: true },
      });
      const status = await api.listSensorStatus();
      setSensorStatus(status.sensors);
    } finally {
      setSensorBusy(false);
    }
  };

  const sendSampleSensorPacket = async () => {
    setSensorBusy(true);
    try {
      const baseRul = latestRul?.predicted_rul_pct ?? 78;
      const response = await api.ingestSensorPayload({
        inverter_id: selectedInverter,
        adapter_mode: source?.hardwareAdapterMode || 'stub',
        transport: 'http',
        firmware: 'gateway-0.1',
        payload: {
          timestamp: Date.now(),
          current_rms: 18 + Math.random() * 8,
          current_peak: 28 + Math.random() * 7,
          temp_c: 38 + Math.random() * 10,
          humidity_pct: 52 + Math.random() * 18,
          voltage_rms: 223 + Math.random() * 12,
          load_pct: 48 + Math.random() * 30,
          cycle_count: Math.round(32000 + (100 - baseRul) * 280 + Math.random() * 120),
          arc_ratio: 1.2 + Math.random() * 0.9,
        },
      });
      setLatestRul({
        inverter_id: selectedInverter,
        ts: response.point.ts,
        predicted_rul_pct: response.prediction.predictedRulPct,
        predicted_status: response.prediction.predictedStatus,
        confidence: response.prediction.confidence ?? null,
        source: response.point.data_origin || 'sensor:stub',
      });
    } finally {
      setSensorBusy(false);
    }
  };

  const updateMode = async (mode: 'simulation' | 'hardware') => {
    await api.setMode(mode);
    const next = await api.getSource();
    setSource(next);
  };

  const updateSpeed = async () => {
    await api.setSimulation({ speedMultiplier: speed });
    const next = await api.getSource();
    setSource(next);
  };

  const toggleSimulation = async () => {
    await api.setSimulation({ enabled: !(source?.simulationEnabled ?? true) });
    const next = await api.getSource();
    setSource(next);
  };

  const retrain = async () => {
    setTraining(true);
    try {
      const res = await api.retrainModel(samples);
      setModel(res.model);
    } finally {
      setTraining(false);
    }
  };

  return (
    <div className="grid-three">
      <div className="surface-card">
        <h3>Simulation Engine</h3>
        <p>Current speed: {source?.speedMultiplier ?? '-'}x</p>
        <p>Tick interval: {source?.simulatorIntervalMs ?? '-'} ms</p>
        <p>Inverters streaming: {source?.inverterCount ?? '-'}</p>
        <input type="range" min={0.25} max={20} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        <div className="button-row">
          <button className="primary-btn" onClick={updateSpeed}>Apply Speed</button>
          <button className="ghost-btn" onClick={toggleSimulation}>{source?.simulationEnabled ? 'Pause Stream' : 'Resume Stream'}</button>
        </div>
      </div>
      <div className="surface-card">
        <h3>Hardware Layer</h3>
        <p>Mode: {source?.mode}</p>
        <div className="button-row">
          <button className="ghost-btn" onClick={() => updateMode('simulation')}>SIM MODE</button>
          <button className="ghost-btn" onClick={() => updateMode('hardware')}>HARDWARE READY</button>
        </div>
      </div>
      <div className="surface-card">
        <h3>ML Engine</h3>
        <p>Regression pseudo-accuracy: {model?.regressionPseudoAccuracy ?? '-'}%</p>
        <p>Classification accuracy: {model?.classificationAccuracy ?? '-'}%</p>
        <p>MAE: {model?.regressionMae ?? '-'}</p>
        <p>Blend weight: {model?.blendWeight ?? '-'}</p>
        <p>Samples: {model?.samples ?? '-'}</p>
        <div className="inline-actions">
          <input type="number" min={5000} max={120000} value={samples} onChange={(e) => setSamples(Number(e.target.value))} />
          <button className="primary-btn" onClick={retrain} disabled={training}>{training ? 'Retraining...' : 'Retrain Model'}</button>
        </div>
      </div>
      <div className="surface-card">
        <h3>Sensor Gateway & Realtime RUL</h3>
        <p>Sensor ingestion API: {source?.sensorIngestionEnabled ? 'enabled' : 'disabled'}</p>
        <p>Connected sensor streams: {sensorStatus.filter((s) => s.status === 'connected').length}</p>
        <div className="field" style={{ marginTop: 10 }}>
          <label>Target inverter</label>
          <select value={selectedInverter} onChange={(e) => setSelectedInverter(e.target.value)}>
            {inverters.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        <div className="button-row" style={{ marginTop: 10 }}>
          <button className="ghost-btn" onClick={connectSensor} disabled={sensorBusy || !selectedInverter}>
            {sensorBusy ? 'Connecting...' : 'Register Sensor Link'}
          </button>
          <button className="primary-btn" onClick={sendSampleSensorPacket} disabled={sensorBusy || !selectedInverter}>
            {sensorBusy ? 'Streaming...' : 'Send Sensor Packet'}
          </button>
        </div>
        <p style={{ marginTop: 10 }}>
          Latest RUL: {latestRul ? `${latestRul.predicted_rul_pct.toFixed(1)}% (${latestRul.predicted_status})` : '-'}
        </p>
        <p className="muted-text" style={{ marginTop: 6 }}>
          This enables live sensor integration today and can be wired to real Raspberry Pi gateway payloads without UI changes.
        </p>
      </div>
    </div>
  );
}
