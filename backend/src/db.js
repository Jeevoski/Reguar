const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let db;

async function initDb(dbPath) {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inverter_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      cycle_count INTEGER NOT NULL,
      voltage_rms REAL NOT NULL,
      current_rms REAL NOT NULL,
      current_peak REAL NOT NULL,
      temp_c REAL NOT NULL,
      load_pct REAL NOT NULL,
      humidity_pct REAL NOT NULL,
      spike_count INTEGER NOT NULL,
      stress_factor REAL NOT NULL,
      temp_integral REAL NOT NULL,
      arc_ratio REAL NOT NULL,
      damage_index REAL NOT NULL,
      rul_pct_true REAL NOT NULL,
      predicted_rul_pct REAL,
      data_origin TEXT NOT NULL DEFAULT 'simulation',
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_inverter_ts ON telemetry (inverter_id, ts);

    CREATE TABLE IF NOT EXISTS service_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inverter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      rul_pct REAL NOT NULL,
      temp_c REAL NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      customer_contact TEXT,
      context_mode TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_service_alerts_open ON service_alerts (acknowledged, created_at DESC);

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inverter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      from_role TEXT NOT NULL,
      to_role TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      severity TEXT NOT NULL,
      channel TEXT NOT NULL,
      acknowledged INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_communications_open ON communications (acknowledged, created_at DESC);

    CREATE TABLE IF NOT EXISTS alert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inverter_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_alert_events_recent ON alert_events (created_at DESC);

    CREATE TABLE IF NOT EXISTS maintenance_jobs (
      inverter_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      note TEXT,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_maintenance_jobs_status ON maintenance_jobs (status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS sensor_connections (
      inverter_id TEXT PRIMARY KEY,
      connected_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      adapter_mode TEXT NOT NULL,
      transport TEXT NOT NULL,
      firmware TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sensor_connections_status ON sensor_connections (status, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS sensor_packets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inverter_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      adapter_mode TEXT NOT NULL,
      transport TEXT NOT NULL,
      quality_score REAL NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sensor_packets_recent ON sensor_packets (inverter_id, ts DESC);

    CREATE TABLE IF NOT EXISTS rul_realtime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inverter_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      predicted_rul_pct REAL NOT NULL,
      predicted_status TEXT NOT NULL,
      confidence REAL,
      source TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_rul_realtime_recent ON rul_realtime (inverter_id, ts DESC);
  `);

  const telemetryColumns = await db.all(`PRAGMA table_info(telemetry)`);
  const hasDataOrigin = telemetryColumns.some((col) => col.name === 'data_origin');
  if (!hasDataOrigin) {
    await db.exec(`ALTER TABLE telemetry ADD COLUMN data_origin TEXT NOT NULL DEFAULT 'simulation'`);
  }

  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb first.');
  }
  return db;
}

async function insertTelemetry(row) {
  const conn = getDb();
  await conn.run(
    `INSERT INTO telemetry (
      inverter_id, ts, cycle_count, voltage_rms, current_rms, current_peak,
      temp_c, load_pct, humidity_pct, spike_count, stress_factor, temp_integral,
      arc_ratio, damage_index, rul_pct_true, predicted_rul_pct, data_origin, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.inverter_id,
      row.ts,
      row.cycle_count,
      row.voltage_rms,
      row.current_rms,
      row.current_peak,
      row.temp_c,
      row.load_pct,
      row.humidity_pct,
      row.spike_count,
      row.stress_factor,
      row.temp_integral,
      row.arc_ratio,
      row.damage_index,
      row.rul_pct_true,
      row.predicted_rul_pct,
      row.data_origin || 'simulation',
      row.status,
    ]
  );
}

async function getLatestPerInverter() {
  const conn = getDb();
  return conn.all(`
    SELECT t.*
    FROM telemetry t
    INNER JOIN (
      SELECT inverter_id, MAX(ts) AS max_ts
      FROM telemetry
      GROUP BY inverter_id
    ) latest
    ON t.inverter_id = latest.inverter_id AND t.ts = latest.max_ts
    ORDER BY t.inverter_id
  `);
}

async function getHistory(inverterId, limit = 200) {
  const conn = getDb();
  const rows = await conn.all(
    `SELECT * FROM telemetry WHERE inverter_id = ? ORDER BY ts DESC LIMIT ?`,
    [inverterId, limit]
  );
  return rows.reverse();
}

async function getRecentRows(inverterId, limit = 100) {
  const conn = getDb();
  const rows = await conn.all(
    `SELECT * FROM telemetry WHERE inverter_id = ? ORDER BY ts DESC LIMIT ?`,
    [inverterId, limit]
  );
  return rows.reverse();
}

async function createServiceAlert(row) {
  const conn = getDb();
  const result = await conn.run(
    `INSERT INTO service_alerts (
      inverter_id, created_at, rul_pct, temp_c, status, priority,
      recommended_action, customer_contact, context_mode, acknowledged
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      row.inverter_id,
      row.created_at,
      row.rul_pct,
      row.temp_c,
      row.status,
      row.priority,
      row.recommended_action,
      row.customer_contact || null,
      row.context_mode,
    ]
  );

  return {
    id: result.lastID,
    ...row,
    acknowledged: 0,
  };
}

async function listServiceAlerts(limit = 50, onlyOpen = true) {
  const conn = getDb();
  if (onlyOpen) {
    return conn.all(
      `SELECT * FROM service_alerts WHERE acknowledged = 0 ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
  }
  return conn.all(
    `SELECT * FROM service_alerts ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

async function acknowledgeServiceAlert(id) {
  const conn = getDb();
  await conn.run(
    `UPDATE service_alerts SET acknowledged = 1 WHERE id = ?`,
    [id]
  );
}

async function createCommunication(row) {
  const conn = getDb();
  const result = await conn.run(
    `INSERT INTO communications (
      inverter_id, created_at, from_role, to_role, subject, message,
      severity, channel, acknowledged
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      row.inverter_id,
      row.created_at,
      row.from_role,
      row.to_role,
      row.subject,
      row.message,
      row.severity,
      row.channel,
    ]
  );

  return {
    id: result.lastID,
    ...row,
    acknowledged: 0,
  };
}

async function listCommunications(limit = 50, toRole = null, onlyOpen = true) {
  const conn = getDb();
  const filters = [];
  const params = [];

  if (onlyOpen) {
    filters.push('acknowledged = 0');
  }
  if (toRole) {
    filters.push('to_role = ?');
    params.push(toRole);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  params.push(limit);

  return conn.all(
    `SELECT * FROM communications ${whereClause} ORDER BY created_at DESC LIMIT ?`,
    params
  );
}

async function acknowledgeCommunication(id) {
  const conn = getDb();
  await conn.run(
    `UPDATE communications SET acknowledged = 1 WHERE id = ?`,
    [id]
  );
}

async function createAlertEvent(row) {
  const conn = getDb();
  const result = await conn.run(
    `INSERT INTO alert_events (inverter_id, created_at, level, message) VALUES (?, ?, ?, ?)`,
    [row.inverter_id, row.created_at, row.level, row.message]
  );

  return {
    id: result.lastID,
    ...row,
  };
}

async function listAlertEvents(limit = 100) {
  const conn = getDb();
  return conn.all(
    `SELECT * FROM alert_events ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

async function upsertMaintenanceJob({ inverter_id, status, note = null }) {
  const conn = getDb();
  const now = Date.now();
  const completedAt = status === 'completed' ? now : null;

  await conn.run(
    `INSERT INTO maintenance_jobs (inverter_id, status, note, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(inverter_id)
     DO UPDATE SET
       status = excluded.status,
       note = excluded.note,
       updated_at = excluded.updated_at,
       completed_at = excluded.completed_at`,
    [inverter_id, status, note, now, completedAt]
  );

  return conn.get(
    `SELECT * FROM maintenance_jobs WHERE inverter_id = ?`,
    [inverter_id]
  );
}

async function listMaintenanceJobs(limit = 200) {
  const conn = getDb();
  return conn.all(
    `SELECT * FROM maintenance_jobs ORDER BY updated_at DESC LIMIT ?`,
    [limit]
  );
}

async function acknowledgeServiceAlertsByInverter(inverterId) {
  const conn = getDb();
  await conn.run(
    `UPDATE service_alerts SET acknowledged = 1 WHERE inverter_id = ? AND acknowledged = 0`,
    [inverterId]
  );
}

async function upsertSensorConnection({
  inverter_id,
  adapter_mode,
  transport,
  firmware = null,
  metadata_json = null,
  status = 'connected',
}) {
  const conn = getDb();
  const now = Date.now();

  await conn.run(
    `INSERT INTO sensor_connections (
      inverter_id, connected_at, last_seen_at, status, adapter_mode, transport, firmware, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(inverter_id)
    DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      status = excluded.status,
      adapter_mode = excluded.adapter_mode,
      transport = excluded.transport,
      firmware = excluded.firmware,
      metadata_json = excluded.metadata_json`,
    [inverter_id, now, now, status, adapter_mode, transport, firmware, metadata_json]
  );

  return conn.get(`SELECT * FROM sensor_connections WHERE inverter_id = ?`, [inverter_id]);
}

async function listSensorConnections(limit = 200) {
  const conn = getDb();
  return conn.all(
    `SELECT * FROM sensor_connections ORDER BY last_seen_at DESC LIMIT ?`,
    [limit]
  );
}

async function insertSensorPacket({ inverter_id, ts, adapter_mode, transport, quality_score, payload_json }) {
  const conn = getDb();
  await conn.run(
    `INSERT INTO sensor_packets (
      inverter_id, ts, adapter_mode, transport, quality_score, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [inverter_id, ts, adapter_mode, transport, quality_score, payload_json]
  );
}

async function insertRealtimeRul({ inverter_id, ts, predicted_rul_pct, predicted_status, confidence = null, source }) {
  const conn = getDb();
  await conn.run(
    `INSERT INTO rul_realtime (
      inverter_id, ts, predicted_rul_pct, predicted_status, confidence, source
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [inverter_id, ts, predicted_rul_pct, predicted_status, confidence, source]
  );
}

async function listRealtimeRul(inverterId, limit = 200) {
  const conn = getDb();
  const rows = await conn.all(
    `SELECT * FROM rul_realtime WHERE inverter_id = ? ORDER BY ts DESC LIMIT ?`,
    [inverterId, limit]
  );
  return rows.reverse();
}

module.exports = {
  initDb,
  getDb,
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
};
