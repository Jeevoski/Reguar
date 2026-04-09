const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const CONFIG = require('./config');
const {
  initDb,
  insertTelemetry,
  getLatestPerInverter,
  getHistory,
  getRecentRows,
  createServiceAlert,
  listServiceAlerts,
  acknowledgeServiceAlert,
  createCommunication,
  listCommunications,
  acknowledgeCommunication,
  createAlertEvent,
  listAlertEvents,
  upsertMaintenanceJob,
  listMaintenanceJobs,
  acknowledgeServiceAlertsByInverter,
  upsertSensorConnection,
  listSensorConnections,
  insertSensorPacket,
  insertRealtimeRul,
  listRealtimeRul,
} = require('./db');
const { createInverterState, updateOneStep, induceFailure } = require('./simulator');
const { createHardwareAdapter } = require('./hardwareAdapter');
const { trainModels, predictFromRecentRows, getModelStats } = require('./ml');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const simulation = {
  speedMultiplier: 1,
  enabled: true,
  mode: 'simulation',
  intervalRef: null,
};

const runtimeState = {
  ready: false,
  initializing: true,
};

const inverterStates = new Map();
const hardwareReadCache = new Map();
const alertState = new Map();
const escalationState = new Map();
const hardwareAdapter = createHardwareAdapter({
  sampleTelemetry: updateOneStep,
  mode: CONFIG.hardwareAdapterMode,
});

function nextInverterId() {
  let idx = 1;
  while (inverterStates.has(`INV-${String(idx).padStart(3, '0')}`)) {
    idx += 1;
  }
  return `INV-${String(idx).padStart(3, '0')}`;
}

function categorizeStatus(predictedRulPct, tempC) {
  const rul = Number(predictedRulPct ?? 100);
  const temp = Number(tempC ?? 30);

  if (rul < 25 || temp >= 72) {
    return 'critical';
  }
  if (rul < 55 || temp >= 60) {
    return 'warning';
  }
  return 'healthy';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSensorPayload(payload, latest, inverterId) {
  const now = Date.now();
  const base = latest || {
    inverter_id: inverterId,
    cycle_count: 0,
    voltage_rms: 230,
    current_rms: 20,
    current_peak: 28,
    temp_c: 32,
    load_pct: 45,
    humidity_pct: 58,
    spike_count: 0,
    stress_factor: 1,
    temp_integral: 0,
    arc_ratio: 1,
    damage_index: 0.1,
    rul_pct_true: 100,
  };

  const cycles = Number(payload.cycle_count ?? payload.hall_cycles ?? base.cycle_count);
  const tempC = Number(payload.temp_c ?? payload.dht22_temp_c ?? base.temp_c);
  const humidityPct = Number(payload.humidity_pct ?? payload.dht22_humidity_pct ?? base.humidity_pct);
  const currentRms = Number(payload.current_rms ?? payload.acs712_current_a ?? base.current_rms);
  const currentPeak = Number(payload.current_peak ?? payload.acs712_peak_a ?? Math.max(currentRms * 1.4, base.current_peak));
  const voltageRms = Number(payload.voltage_rms ?? payload.ina219_voltage_v ?? base.voltage_rms);
  const loadPct = Number(payload.load_pct ?? base.load_pct);
  const arcRatio = Number(payload.arc_ratio ?? base.arc_ratio);
  const ts = Number(payload.ts || payload.timestamp || now);

  const spikeCount = Math.max(0, Math.round((base.spike_count || 0) + Math.max(0, arcRatio - 1.2) * 2));
  const stressFactor = clamp(
    0.45 * (loadPct / 100) +
      0.32 * (tempC / 80) +
      0.15 * (humidityPct / 100) +
      0.18 * (arcRatio / 2.5),
    0.4,
    6.8
  );
  const tempIntegral = Math.max(0, (base.temp_integral || 0) + Math.max(0, tempC - 22));
  const damageIndex = clamp(
    0.43 * (cycles / CONFIG.ratedCyclesDefault) +
      0.26 * (tempIntegral / 150000) +
      0.19 * (arcRatio / 2.5) +
      0.12 * (loadPct / 100),
    0,
    2.8
  );
  const rulPctTrue = clamp((1 - damageIndex / 2.8) * 100, 0, 100);

  return {
    inverter_id: inverterId,
    ts,
    cycle_count: Math.max(0, Math.round(cycles)),
    voltage_rms: clamp(voltageRms, 100, 400),
    current_rms: clamp(currentRms, 0, 500),
    current_peak: clamp(currentPeak, 0, 700),
    temp_c: clamp(tempC, -20, 140),
    load_pct: clamp(loadPct, 0, 100),
    humidity_pct: clamp(humidityPct, 0, 100),
    spike_count: spikeCount,
    stress_factor: stressFactor,
    temp_integral: tempIntegral,
    arc_ratio: clamp(arcRatio, 0.5, 4),
    damage_index: damageIndex,
    rul_pct_true: rulPctTrue,
  };
}

function sensorQualityScore(payload) {
  let score = 1;
  const fields = [
    payload.current_rms ?? payload.acs712_current_a,
    payload.temp_c ?? payload.dht22_temp_c,
    payload.humidity_pct ?? payload.dht22_humidity_pct,
    payload.voltage_rms ?? payload.ina219_voltage_v,
    payload.cycle_count ?? payload.hall_cycles,
  ];
  const missing = fields.filter((v) => typeof v !== 'number' || Number.isNaN(v)).length;
  score -= missing * 0.14;
  return Number(clamp(score, 0.2, 1).toFixed(2));
}

function inferAlertLevel(point, prediction) {
  if (prediction.predictedStatus === 'critical' || prediction.predictedRulPct < 22 || point.temp_c > 70) {
    return 'critical';
  }
  if (prediction.predictedStatus === 'warning' || prediction.predictedRulPct < 45 || point.temp_c > 58) {
    return 'warning';
  }
  return 'info';
}

function shouldEmitAlert(inverterId, level) {
  if (level === 'info') {
    return false;
  }

  const now = Date.now();
  const previous = alertState.get(inverterId);
  const rank = { info: 0, warning: 1, critical: 2 };
  const cooldownMs = level === 'critical' ? 6000 : 12000;

  if (!previous || now - previous.ts > cooldownMs || rank[level] > rank[previous.level]) {
    alertState.set(inverterId, { level, ts: now });
    return true;
  }

  return false;
}

function shouldEscalate(inverterId, level) {
  if (level === 'info') {
    return false;
  }

  const now = Date.now();
  const previous = escalationState.get(inverterId);
  const cooldownMs = level === 'critical' ? 90_000 : 180_000;
  if (!previous || now - previous.ts > cooldownMs || (previous.level === 'warning' && level === 'critical')) {
    escalationState.set(inverterId, { level, ts: now });
    return true;
  }
  return false;
}

async function addInverter({ inverterId, profile = {} }) {
  const id = String(inverterId || nextInverterId()).trim().toUpperCase();
  if (!/^INV-\d{3,}$/.test(id)) {
    throw new Error('inverter_id must follow INV-001 format');
  }
  if (inverterStates.has(id)) {
    throw new Error(`Inverter ${id} already exists`);
  }

  const state = createInverterState(id, CONFIG.ratedCyclesDefault, profile);
  inverterStates.set(id, state);

  // Seed short history so charts and model features are immediately meaningful.
  for (let j = 0; j < 120; j += 1) {
    const sample = updateOneStep(state, 0.8);
    sample.ts = Date.now() - (120 - j) * CONFIG.simulatorIntervalMs;
    await insertTelemetry(sample);
  }

  const recentRows = await getRecentRows(id, 99);
  const prediction = await predictFromRecentRows(recentRows);
  const latest = recentRows[recentRows.length - 1];

  if (latest) {
    await insertTelemetry({
      ...latest,
      ts: Date.now(),
      predicted_rul_pct: prediction.predictedRulPct,
      status: prediction.predictedStatus,
    });
  }

  return id;
}

function maintenanceRecommendation(point) {
  if (!point) {
    return {
      priority: 'low',
      summary: 'Insufficient telemetry yet. Continue monitoring.',
      actions: ['Collect more runtime telemetry for stable maintenance recommendations.'],
    };
  }

  const actions = [];
  let priority = 'low';
  let summary = 'Relay health is stable. Continue periodic monitoring.';

  if ((point.predicted_rul_pct ?? point.rul_pct_true) < 25 || point.temp_c > 70) {
    priority = 'critical';
    summary = 'Immediate maintenance required to avoid relay/contactor failure.';
    actions.push('Raise service ticket with customer care immediately.');
    actions.push('Schedule relay/contactor replacement within 24 hours.');
    actions.push('Reduce inverter loading to below 60% until service closure.');
  } else if ((point.predicted_rul_pct ?? point.rul_pct_true) < 50 || point.temp_c > 55) {
    priority = 'medium';
    summary = 'Degradation trend detected. Plan preventive maintenance.';
    actions.push('Schedule preventive inspection in next maintenance window.');
    actions.push('Check contact erosion and tightening torque.');
    actions.push('Validate cooling airflow and cabinet temperature.');
  } else {
    actions.push('Keep standard monthly inspection cadence.');
    actions.push('Review trend growth in cycle count and arc ratio.');
  }

  if (point.arc_ratio > 1.8) {
    actions.push('Investigate switching spikes and arcing suppression network.');
  }
  if (point.load_pct > 85) {
    actions.push('Rebalance downstream load to reduce thermal stress.');
  }
  if (point.humidity_pct > 78) {
    actions.push('Inspect enclosure sealing and condensation control due to high humidity.');
  }

  return { priority, summary, actions };
}

function fleetFromRows(rows) {
  return rows
    .filter((row) => inverterStates.has(row.inverter_id))
    .map((row) => {
    const predictedRul = row.predicted_rul_pct ?? row.rul_pct_true;
    const normalizedStatus = categorizeStatus(predictedRul, row.temp_c);

    return ({
    inverter_id: row.inverter_id,
    status: normalizedStatus,
    predicted_status: normalizedStatus,
    cycle_count: row.cycle_count,
    rul_pct_true: row.rul_pct_true,
    predicted_rul_pct: predictedRul,
    temp_c: row.temp_c,
    current_rms: row.current_rms,
    voltage_rms: row.voltage_rms,
    humidity_pct: row.humidity_pct,
    load_pct: row.load_pct,
    data_origin: row.data_origin || 'simulation',
    last_alert: normalizedStatus === 'critical' ? new Date(row.ts).toISOString() : null,
    ts: row.ts,
  });
  });
}

async function oneSimulationTick() {
  if (!simulation.enabled || !runtimeState.ready) {
    io.emit('source:update', {
      mode: simulation.mode,
      simulationEnabled: simulation.enabled,
      hardwareReady: simulation.mode === 'hardware',
      sensorIngestionEnabled: true,
    });
    return;
  }

  for (const inverterState of inverterStates.values()) {
    let sample;
    if (simulation.mode === 'hardware') {
      const sensorPacket = hardwareAdapter.readSensors(inverterState, simulation.speedMultiplier);
      hardwareReadCache.set(inverterState.inverter_id, sensorPacket);
      sample = sensorPacket.telemetry;
    } else {
      sample = updateOneStep(inverterState, simulation.speedMultiplier);
    }

    const recentRows = await getRecentRows(sample.inverter_id, 99);
    const prediction = await predictFromRecentRows([...recentRows, sample]);

    const finalizedPoint = {
      ...sample,
      predicted_rul_pct: prediction.predictedRulPct,
      data_origin: simulation.mode === 'hardware' ? `hardware:${hardwareAdapter.mode}` : 'simulation',
      status: categorizeStatus(prediction.predictedRulPct, sample.temp_c),
    };
    await insertTelemetry(finalizedPoint);
    await insertRealtimeRul({
      inverter_id: finalizedPoint.inverter_id,
      ts: finalizedPoint.ts,
      predicted_rul_pct: finalizedPoint.predicted_rul_pct,
      predicted_status: finalizedPoint.status,
      confidence: prediction.confidence ?? null,
      source: finalizedPoint.data_origin,
    });

    if (simulation.mode === 'hardware') {
      const packet = hardwareReadCache.get(sample.inverter_id);
      if (packet) {
        await upsertSensorConnection({
          inverter_id: sample.inverter_id,
          adapter_mode: hardwareAdapter.mode,
          transport: 'modbus+gpio',
          firmware: 'unknown',
          metadata_json: JSON.stringify({ mode: 'hardware-loop' }),
          status: 'connected',
        });
        await insertSensorPacket({
          inverter_id: sample.inverter_id,
          ts: finalizedPoint.ts,
          adapter_mode: hardwareAdapter.mode,
          transport: 'modbus+gpio',
          quality_score: 0.82,
          payload_json: JSON.stringify(packet),
        });
      }
    }

    io.emit('telemetry:update', {
      inverter_id: sample.inverter_id,
      point: {
        ...finalizedPoint,
      },
    });
    io.emit('rul:update', {
      inverter_id: sample.inverter_id,
      ts: finalizedPoint.ts,
      predicted_rul_pct: finalizedPoint.predicted_rul_pct,
      predicted_status: finalizedPoint.status,
      confidence: prediction.confidence ?? null,
      source: finalizedPoint.data_origin,
    });

    const level = inferAlertLevel(sample, prediction);
    if (shouldEmitAlert(sample.inverter_id, level)) {
      const emittedAlert = {
        inverter_id: sample.inverter_id,
        level,
        message:
          level === 'critical'
            ? `Inverter ${sample.inverter_id} critical: RUL ${prediction.predictedRulPct.toFixed(1)}%, Temp ${sample.temp_c.toFixed(1)}C`
            : `Inverter ${sample.inverter_id} warning: degradation trend detected`,
        ts: Date.now(),
      };

      await createAlertEvent({
        inverter_id: emittedAlert.inverter_id,
        created_at: emittedAlert.ts,
        level: emittedAlert.level,
        message: emittedAlert.message,
      });

      io.emit('alert', {
        inverter_id: emittedAlert.inverter_id,
        level: emittedAlert.level,
        message: emittedAlert.message,
        ts: emittedAlert.ts,
      });
    }

    if (shouldEscalate(sample.inverter_id, level)) {
      const recommendation = maintenanceRecommendation(finalizedPoint);
      const alert = await createServiceAlert({
        inverter_id: sample.inverter_id,
        created_at: Date.now(),
        rul_pct: finalizedPoint.predicted_rul_pct ?? finalizedPoint.rul_pct_true,
        temp_c: finalizedPoint.temp_c,
        status: finalizedPoint.status,
        priority: recommendation.priority,
        recommended_action: `${recommendation.summary} ${recommendation.actions.join(' ')}`,
        customer_contact: null,
        context_mode: simulation.mode,
      });

      io.emit('service-alert:new', alert);

      await pushCommunication({
        inverter_id: sample.inverter_id,
        from_role: 'ai_engine',
        to_role: 'maintenance_team',
        subject: `AI predictive alert for ${sample.inverter_id}`,
        message: `Priority ${recommendation.priority.toUpperCase()}. ${recommendation.summary}`,
        severity: recommendation.priority,
        channel: 'internal',
      });

      await pushCommunication({
        inverter_id: sample.inverter_id,
        from_role: 'ai_engine',
        to_role: 'customer_user',
        subject: `Service advisory for ${sample.inverter_id}`,
        message: `Predictive maintenance advisory: ${recommendation.summary}`,
        severity: recommendation.priority,
        channel: 'email',
      });
    }
  }

  const latestRows = await getLatestPerInverter();
  io.emit('fleet:update', fleetFromRows(latestRows));
  io.emit('source:update', {
    mode: simulation.mode,
    simulationEnabled: simulation.enabled,
    hardwareReady: simulation.mode === 'hardware',
    sensorIngestionEnabled: true,
  });
}

async function seedHistory() {
  const profiles = [
    { wearFactor: 0.85, cycle_count: 14000, load_pct: 46, humidity_pct: 52, temp_c: 31 },
    { wearFactor: 0.95, cycle_count: 26000, load_pct: 58, humidity_pct: 60, temp_c: 35 },
    { wearFactor: 1.05, cycle_count: 38000, load_pct: 63, humidity_pct: 64, temp_c: 38 },
    { wearFactor: 1.18, cycle_count: 52000, load_pct: 72, humidity_pct: 68, temp_c: 43 },
    { wearFactor: 1.3, cycle_count: 66000, load_pct: 84, humidity_pct: 72, temp_c: 49 },
  ];
  for (let i = 1; i <= CONFIG.inverterCount; i += 1) {
    const id = `INV-${String(i).padStart(3, '0')}`;
    const state = createInverterState(id, CONFIG.ratedCyclesDefault, profiles[(i - 1) % profiles.length]);
    inverterStates.set(id, state);

    for (let j = 0; j < CONFIG.seedHistoryPoints; j += 1) {
      const sample = updateOneStep(state, 0.7);
      sample.ts = Date.now() - (CONFIG.seedHistoryPoints - j) * CONFIG.simulatorIntervalMs;
      await insertTelemetry(sample);
    }
  }
}

async function pushCommunication({ inverter_id, from_role, to_role, subject, message, severity, channel = 'dashboard' }) {
  const communication = await createCommunication({
    inverter_id,
    created_at: Date.now(),
    from_role,
    to_role,
    subject,
    message,
    severity,
    channel,
  });
  io.emit('communication:new', communication);
  return communication;
}

function restartSimulator() {
  if (simulation.intervalRef) {
    clearInterval(simulation.intervalRef);
  }

  simulation.intervalRef = setInterval(() => {
    oneSimulationTick().catch((error) => {
      console.error('Simulation tick failed:', error);
    });
  }, CONFIG.simulatorIntervalMs);
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'relay-rul-backend',
    simulation_speed: simulation.speedMultiplier,
    simulator_interval_ms: CONFIG.simulatorIntervalMs,
    simulation_enabled: simulation.enabled,
    mode: simulation.mode,
    inverter_count: inverterStates.size,
    ready: runtimeState.ready,
    initializing: runtimeState.initializing,
  });
});

app.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'relay-rul-backend',
    message: 'Backend is running. Open frontend at http://localhost:3000',
    endpoints: [
      '/api/health',
      '/api/fleet',
      '/api/source',
      '/api/sensors/status',
      '/api/sensors/:id/rul',
      '/api/sensors/connect',
      '/api/sensors/ingest',
      '/api/inverter/:id/history',
      '/api/read-sensors',
      '/api/modbus/registers',
    ],
  });
});

app.get('/api/source', (_req, res) => {
  res.json({
    mode: simulation.mode,
    simulationEnabled: simulation.enabled,
    speedMultiplier: simulation.speedMultiplier,
    simulatorIntervalMs: CONFIG.simulatorIntervalMs,
    inverterCount: inverterStates.size,
    hardwareReady: simulation.mode === 'hardware',
    hardwareAdapterMode: hardwareAdapter.mode,
    sensorIngestionEnabled: true,
  });
});

app.get('/api/sensors/status', async (req, res) => {
  const limit = Number(req.query.limit || 200);
  const sensors = await listSensorConnections(limit);
  res.json({
    sensors,
    total: sensors.length,
    connected: sensors.filter((s) => s.status === 'connected').length,
  });
});

app.get('/api/sensors/:id/rul', async (req, res) => {
  const inverterId = String(req.params.id || '').trim().toUpperCase();
  const limit = Number(req.query.limit || 240);
  if (!inverterId) {
    res.status(400).json({ ok: false, message: 'inverter id is required' });
    return;
  }

  const rul = await listRealtimeRul(inverterId, limit);
  res.json({ inverter_id: inverterId, rul });
});

app.post('/api/sensors/connect', async (req, res) => {
  const inverterId = String(req.body.inverter_id || '').trim().toUpperCase();
  const adapterMode = String(req.body.adapter_mode || hardwareAdapter.mode || 'stub').trim().toLowerCase();
  const transport = String(req.body.transport || 'modbus+gpio').trim().toLowerCase();
  const firmware = req.body.firmware ? String(req.body.firmware).trim() : null;
  const metadata = req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};

  if (!inverterId || !inverterStates.has(inverterId)) {
    res.status(404).json({ ok: false, message: 'inverter not found' });
    return;
  }

  const sensor = await upsertSensorConnection({
    inverter_id: inverterId,
    adapter_mode: adapterMode,
    transport,
    firmware,
    metadata_json: JSON.stringify(metadata),
    status: 'connected',
  });

  io.emit('sensor:status', sensor);
  res.json({ ok: true, sensor });
});

app.post('/api/sensors/ingest', async (req, res) => {
  const inverterId = String(req.body.inverter_id || '').trim().toUpperCase();
  const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : req.body;
  const adapterMode = String(req.body.adapter_mode || 'external').trim().toLowerCase();
  const transport = String(req.body.transport || 'http').trim().toLowerCase();
  const firmware = req.body.firmware ? String(req.body.firmware).trim() : null;

  if (!inverterId || !inverterStates.has(inverterId)) {
    res.status(404).json({ ok: false, message: 'inverter not found' });
    return;
  }

  const recentRows = await getRecentRows(inverterId, 120);
  const latest = recentRows[recentRows.length - 1] || null;
  const sensorPoint = normalizeSensorPayload(payload, latest, inverterId);
  const prediction = await predictFromRecentRows([...recentRows, sensorPoint]);

  const finalizedPoint = {
    ...sensorPoint,
    predicted_rul_pct: prediction.predictedRulPct,
    status: categorizeStatus(prediction.predictedRulPct, sensorPoint.temp_c),
    data_origin: `sensor:${adapterMode}`,
  };

  await insertTelemetry(finalizedPoint);
  await insertRealtimeRul({
    inverter_id: inverterId,
    ts: finalizedPoint.ts,
    predicted_rul_pct: finalizedPoint.predicted_rul_pct,
    predicted_status: finalizedPoint.status,
    confidence: prediction.confidence ?? null,
    source: finalizedPoint.data_origin,
  });
  await upsertSensorConnection({
    inverter_id: inverterId,
    adapter_mode: adapterMode,
    transport,
    firmware,
    metadata_json: JSON.stringify({ ingest: 'api', fields: Object.keys(payload || {}) }),
    status: 'connected',
  });
  await insertSensorPacket({
    inverter_id: inverterId,
    ts: finalizedPoint.ts,
    adapter_mode: adapterMode,
    transport,
    quality_score: sensorQualityScore(payload || {}),
    payload_json: JSON.stringify(payload || {}),
  });

  io.emit('telemetry:update', {
    inverter_id: inverterId,
    point: finalizedPoint,
  });

  const latestRows = await getLatestPerInverter();
  io.emit('fleet:update', fleetFromRows(latestRows));
  io.emit('rul:update', {
    inverter_id: inverterId,
    ts: finalizedPoint.ts,
    predicted_rul_pct: finalizedPoint.predicted_rul_pct,
    predicted_status: finalizedPoint.status,
    confidence: prediction.confidence ?? null,
    source: finalizedPoint.data_origin,
  });

  res.json({
    ok: true,
    point: finalizedPoint,
    prediction,
  });
});

app.post('/api/auth/login', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const token = String(req.body.token || '').trim();
  const context = String(req.body.context || 'command-centre');

  if (!email || !token) {
    res.status(400).json({ ok: false, message: 'email and token are required' });
    return;
  }

  const allowedContexts = new Set(['command-centre', 'customer-care', 'maintenance-lead']);
  if (!allowedContexts.has(context)) {
    res.status(400).json({ ok: false, message: 'invalid operational context' });
    return;
  }

  // Demo auth flow for hackathon mode. Replace with real IAM/JWT validation in production.
  const session = {
    user: {
      email,
      context,
      role:
        context === 'customer-care'
          ? 'customer_care'
          : context === 'maintenance-lead'
            ? 'maintenance_lead'
            : 'command_centre',
    },
    issuedAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
  };

  res.json({ ok: true, session });
});

app.get('/api/fleet', async (_req, res) => {
  if (!runtimeState.ready) {
    res.json({
      fleet: [],
      model: getModelStats(),
      initializing: true,
    });
    return;
  }

  const latestRows = await getLatestPerInverter();
  res.json({
    fleet: fleetFromRows(latestRows),
    model: getModelStats(),
    initializing: false,
  });
});

app.get('/api/inverter/:id/history', async (req, res) => {
  if (!runtimeState.ready) {
    res.json({ inverter_id: req.params.id, history: [], initializing: true });
    return;
  }
  const limit = Number(req.query.limit || 200);
  const history = await getHistory(req.params.id, limit);
  res.json({ inverter_id: req.params.id, history, initializing: false });
});

app.post('/api/control/speed', (req, res) => {
  const nextSpeed = Number(req.body.multiplier || 1);
  simulation.speedMultiplier = Math.max(0.25, Math.min(nextSpeed, 10));
  res.json({ ok: true, speedMultiplier: simulation.speedMultiplier });
});

app.post('/api/simulate', (req, res) => {
  if (typeof req.body.enabled === 'boolean') {
    simulation.enabled = req.body.enabled;
  }
  if (typeof req.body.speedMultiplier === 'number') {
    simulation.speedMultiplier = Math.max(0.25, Math.min(req.body.speedMultiplier, 20));
  }
  res.json({
    ok: true,
    mode: simulation.mode,
    simulationEnabled: simulation.enabled,
    speedMultiplier: simulation.speedMultiplier,
  });
});

app.post('/api/mode', (req, res) => {
  const mode = req.body.mode;
  if (!['simulation', 'hardware'].includes(mode)) {
    res.status(400).json({ ok: false, message: 'mode must be simulation or hardware' });
    return;
  }
  simulation.mode = mode;
  res.json({
    ok: true,
    mode: simulation.mode,
    hardwareReady: simulation.mode === 'hardware',
  });
});

app.get('/api/read-sensors', (req, res) => {
  const inverterId = String(req.query.id || 'INV-001');
  const state = inverterStates.get(inverterId);

  if (!state) {
    res.status(404).json({ ok: false, message: 'Inverter not found' });
    return;
  }

  const packet = hardwareReadCache.get(inverterId) || hardwareAdapter.readSensors(state, simulation.speedMultiplier);
  hardwareReadCache.set(inverterId, packet);

  res.json({
    ok: true,
    mode: simulation.mode,
    packet,
    hardwareAdapterMode: hardwareAdapter.mode,
    hardwareAdapter: {
      modbusRegisters: ['3002 current', '3019 temp', '3008 voltage', '3025 cycle_count'],
      future: 'Use modbus-serial and sensor drivers on Raspberry Pi.',
    },
  });
});

app.get('/api/modbus/registers', (req, res) => {
  const inverterId = String(req.query.id || 'INV-001');
  const state = inverterStates.get(inverterId);

  if (!state) {
    res.status(404).json({ ok: false, message: 'Inverter not found' });
    return;
  }

  const modbus = hardwareAdapter.readModbusRegisters(state, simulation.speedMultiplier);
  res.json({
    ok: true,
    mode: simulation.mode,
    hardwareAdapterMode: hardwareAdapter.mode,
    inverter_id: inverterId,
    registers: modbus.registers,
    timestamp: modbus.telemetry.ts,
    note: 'MODBUS register stub for future modbus-serial integration.',
  });
});

app.post('/api/control/failure', (req, res) => {
  const id = req.body.id;
  const mode = req.body.mode || 'thermal';

  if (!inverterStates.has(id)) {
    res.status(404).json({ ok: false, message: 'Inverter not found' });
    return;
  }

  induceFailure(inverterStates.get(id), mode);
  res.json({ ok: true, id, mode });
});

app.post('/api/control/reset', async (req, res) => {
  const id = req.body.id;

  if (id) {
    if (!inverterStates.has(id)) {
      res.status(404).json({ ok: false, message: 'Inverter not found' });
      return;
    }
    inverterStates.set(id, createInverterState(id));
    res.json({ ok: true, id });
    return;
  }

  for (const inverterId of inverterStates.keys()) {
    inverterStates.set(inverterId, createInverterState(inverterId));
  }
  res.json({ ok: true, reset: 'all' });
});

app.get('/api/inverters', (_req, res) => {
  const inverters = Array.from(inverterStates.keys()).sort();
  res.json({ inverters, count: inverters.length });
});

app.post('/api/inverters', async (req, res) => {
  try {
    const inverterId = req.body.inverter_id;
    const profile = req.body.profile || {};
    const id = await addInverter({ inverterId, profile });
    const latestRows = await getLatestPerInverter();
    io.emit('fleet:update', fleetFromRows(latestRows));
    res.json({ ok: true, inverter_id: id, count: inverterStates.size });
  } catch (error) {
    res.status(400).json({ ok: false, message: error.message || 'Failed to add inverter' });
  }
});

app.get('/api/model-metrics', (_req, res) => {
  res.json(getModelStats());
});

app.post('/api/model-retrain', async (req, res) => {
  const samples = Number(req.body.samples || CONFIG.trainingSamples);
  await trainModels(samples);
  res.json({ ok: true, model: getModelStats() });
});

app.get('/api/maintenance/:id', async (req, res) => {
  const history = await getHistory(req.params.id, 1);
  const latest = history[history.length - 1];
  const recommendation = maintenanceRecommendation(latest);

  res.json({
    inverter_id: req.params.id,
    latest: latest || null,
    recommendation,
  });
});

app.get('/api/maintenance-jobs', async (req, res) => {
  const limit = Number(req.query.limit || 200);
  const jobs = await listMaintenanceJobs(limit);
  res.json({ jobs });
});

app.post('/api/maintenance-jobs/dispatch', async (req, res) => {
  const inverterId = String(req.body.inverter_id || '').trim().toUpperCase();
  const message = String(req.body.message || '').trim();

  if (!inverterId) {
    res.status(400).json({ ok: false, message: 'inverter_id is required' });
    return;
  }

  const recommendationPayload = await getHistory(inverterId, 1);
  const latest = recommendationPayload[recommendationPayload.length - 1];
  const recommendation = maintenanceRecommendation(latest);

  await pushCommunication({
    inverter_id: inverterId,
    from_role: 'maintenance_control',
    to_role: 'maintenance_team',
    subject: `Maintenance help dispatched for ${inverterId}`,
    message: message || `${recommendation.summary} ${recommendation.actions.join(' ')}`,
    severity: recommendation.priority,
    channel: 'internal',
  });

  const job = await upsertMaintenanceJob({
    inverter_id: inverterId,
    status: 'planned',
    note: 'Maintenance help dispatched by user',
  });

  res.json({ ok: true, job });
});

app.post('/api/maintenance-jobs/:inverterId/status', async (req, res) => {
  const inverterId = String(req.params.inverterId || '').trim().toUpperCase();
  const status = String(req.body.status || '').trim().toLowerCase();
  const note = req.body.note ? String(req.body.note) : null;

  if (!inverterId) {
    res.status(400).json({ ok: false, message: 'inverter_id is required' });
    return;
  }

  if (!['unassigned', 'planned', 'onsite', 'completed'].includes(status)) {
    res.status(400).json({ ok: false, message: 'status must be unassigned/planned/onsite/completed' });
    return;
  }

  const job = await upsertMaintenanceJob({
    inverter_id: inverterId,
    status,
    note,
  });

  if (status === 'completed') {
    await acknowledgeServiceAlertsByInverter(inverterId);
    io.emit('service-alert:ack', { inverter_id: inverterId, all: true });
  }

  res.json({ ok: true, job });
});

app.get('/api/service-alerts', async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const onlyOpen = req.query.onlyOpen !== 'false';
  const alerts = await listServiceAlerts(limit, onlyOpen);
  res.json({ alerts });
});

app.get('/api/alert-events', async (req, res) => {
  const limit = Number(req.query.limit || 100);
  const events = await listAlertEvents(limit);
  res.json({ events });
});

app.post('/api/service-alerts', async (req, res) => {
  const inverterId = String(req.body.inverter_id || '');
  const customerContact = req.body.customer_contact || null;

  if (!inverterId) {
    res.status(400).json({ ok: false, message: 'inverter_id is required' });
    return;
  }

  const history = await getHistory(inverterId, 1);
  const latest = history[history.length - 1];
  if (!latest) {
    res.status(404).json({ ok: false, message: 'No telemetry found for inverter' });
    return;
  }

  const recommendation = maintenanceRecommendation(latest);
  const alert = await createServiceAlert({
    inverter_id: inverterId,
    created_at: Date.now(),
    rul_pct: latest.predicted_rul_pct ?? latest.rul_pct_true,
    temp_c: latest.temp_c,
    status: latest.status,
    priority: recommendation.priority,
    recommended_action: `${recommendation.summary} ${recommendation.actions.join(' ')}`,
    customer_contact: customerContact,
    context_mode: simulation.mode,
  });

  io.emit('service-alert:new', alert);

  await pushCommunication({
    inverter_id: inverterId,
    from_role: 'customer_care',
    to_role: 'maintenance_team',
    subject: `Maintenance escalation for ${inverterId}`,
    message: recommendation.summary,
    severity: recommendation.priority,
    channel: 'internal',
  });

  if (customerContact) {
    await pushCommunication({
      inverter_id: inverterId,
      from_role: 'customer_care',
      to_role: 'customer_user',
      subject: `Service update for ${inverterId}`,
      message: `Your inverter shows ${latest.status} condition. Recommended action: ${recommendation.summary}`,
      severity: recommendation.priority,
      channel: 'email',
    });
  }

  res.json({ ok: true, alert });
});

app.post('/api/service-alerts/:id/ack', async (req, res) => {
  await acknowledgeServiceAlert(Number(req.params.id));
  io.emit('service-alert:ack', { id: Number(req.params.id) });
  res.json({ ok: true, id: Number(req.params.id) });
});

app.get('/api/communications', async (req, res) => {
  const limit = Number(req.query.limit || 50);
  const toRole = req.query.toRole ? String(req.query.toRole) : null;
  const onlyOpen = req.query.onlyOpen !== 'false';
  const communications = await listCommunications(limit, toRole, onlyOpen);
  res.json({ communications });
});

app.post('/api/communications', async (req, res) => {
  const inverterId = String(req.body.inverter_id || '');
  const toRole = String(req.body.to_role || 'customer_user');
  const subject = String(req.body.subject || 'Maintenance update');
  const message = String(req.body.message || 'Please review maintenance recommendation.');
  const severity = String(req.body.severity || 'medium');
  const channel = String(req.body.channel || 'dashboard');

  if (!inverterId || !message) {
    res.status(400).json({ ok: false, message: 'inverter_id and message are required' });
    return;
  }

  const communication = await pushCommunication({
    inverter_id: inverterId,
    from_role: 'customer_care',
    to_role: toRole,
    subject,
    message,
    severity,
    channel,
  });

  res.json({ ok: true, communication });
});

app.post('/api/communications/:id/ack', async (req, res) => {
  await acknowledgeCommunication(Number(req.params.id));
  io.emit('communication:ack', { id: Number(req.params.id) });
  res.json({ ok: true, id: Number(req.params.id) });
});

async function bootstrap() {
  await initDb(CONFIG.dbPath);

  io.on('connection', (socket) => {
    socket.emit('connected', {
      message: 'Socket connected',
      mode: simulation.mode,
      simulationEnabled: simulation.enabled,
      hardwareReady: simulation.mode === 'hardware',
      sensorIngestionEnabled: true,
    });
  });

  httpServer.listen(CONFIG.port, () => {
    console.log(`Backend listening on http://localhost:${CONFIG.port}`);
  });

  const initializeAsync = async () => {
    try {
      console.log('Initializing ML models and simulation seed data...');
      await trainModels();
      await seedHistory();
      restartSimulator();
      runtimeState.ready = true;
      runtimeState.initializing = false;
      console.log('Initialization complete. Live simulation is running.');
    } catch (error) {
      runtimeState.initializing = false;
      console.error('Initialization failed:', error);
    }
  };

  initializeAsync();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
