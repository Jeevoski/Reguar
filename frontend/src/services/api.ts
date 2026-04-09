import type {
  Communication,
  FleetItem,
  MaintenanceJob,
  ModelStats,
  MaintenanceRecommendation,
  RealtimeRulPoint,
  SensorConnection,
  ServiceAlert,
  SourceState,
  TelemetryPoint,
} from '../types/domain';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return (await res.json()) as T;
}

export const api = {
  login: (payload: { email: string; token: string; context: 'command-centre' | 'customer-care' | 'maintenance-lead' }) =>
    request<{ ok: boolean; session: { user: { email: string; context: string; role: string }; issuedAt: number; expiresAt: number } }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getFleet: () => request<{ fleet: FleetItem[]; model: unknown; initializing: boolean }>('/api/fleet'),
  getSource: () => request<SourceState>('/api/source'),
  getHistory: (id: string, limit = 240) => request<{ history: TelemetryPoint[] }>(`/api/inverter/${id}/history?limit=${limit}`),
  getModelMetrics: () => request<ModelStats>('/api/model-metrics'),
  retrainModel: (samples?: number) => request<{ ok: boolean; model: ModelStats }>('/api/model-retrain', {
    method: 'POST',
    body: JSON.stringify(samples ? { samples } : {}),
  }),
  addInverter: (payload?: { inverter_id?: string; profile?: Record<string, number> }) =>
    request<{ ok: boolean; inverter_id: string; count: number }>('/api/inverters', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  listInverters: () => request<{ inverters: string[]; count: number }>('/api/inverters'),
  getMaintenanceRecommendation: (id: string) => request<MaintenanceRecommendation>(`/api/maintenance/${id}`),
  listMaintenanceJobs: (limit = 200) => request<{ jobs: MaintenanceJob[] }>(`/api/maintenance-jobs?limit=${limit}`),
  dispatchMaintenanceHelp: (payload: { inverter_id: string; message?: string }) =>
    request<{ ok: boolean; job: MaintenanceJob }>('/api/maintenance-jobs/dispatch', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMaintenanceStatus: (inverterId: string, status: MaintenanceJob['status'], note?: string) =>
    request<{ ok: boolean; job: MaintenanceJob }>(`/api/maintenance-jobs/${inverterId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),
  listServiceAlerts: (onlyOpen = true, limit = 30) =>
    request<{ alerts: ServiceAlert[] }>(`/api/service-alerts?onlyOpen=${onlyOpen ? 'true' : 'false'}&limit=${limit}`),
  listAlertEvents: (limit = 100) =>
    request<{ events: Array<{ id: number; inverter_id: string; created_at: number; level: string; message: string }> }>(
      `/api/alert-events?limit=${limit}`
    ),
  createServiceAlert: (payload: { inverter_id: string; customer_contact?: string }) =>
    request('/api/service-alerts', { method: 'POST', body: JSON.stringify(payload) }),
  ackServiceAlert: (id: number) => request(`/api/service-alerts/${id}/ack`, { method: 'POST' }),
  listCommunications: () => request<{ communications: Communication[] }>('/api/communications?onlyOpen=true&limit=30'),
  sendCommunication: (payload: {
    inverter_id: string;
    to_role: string;
    subject: string;
    message: string;
    severity: string;
    channel: string;
  }) => request('/api/communications', { method: 'POST', body: JSON.stringify(payload) }),
  ackCommunication: (id: number) => request(`/api/communications/${id}/ack`, { method: 'POST' }),
  setMode: (mode: 'simulation' | 'hardware') => request('/api/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  setSimulation: (payload: { enabled?: boolean; speedMultiplier?: number }) =>
    request('/api/simulate', { method: 'POST', body: JSON.stringify(payload) }),
  injectFailure: (payload: { id: string; mode: 'thermal' | 'electrical' | 'wear' }) =>
    request('/api/control/failure', { method: 'POST', body: JSON.stringify(payload) }),
  connectSensor: (payload: {
    inverter_id: string;
    adapter_mode?: string;
    transport?: string;
    firmware?: string;
    metadata?: Record<string, unknown>;
  }) =>
    request<{ ok: boolean; sensor: SensorConnection }>('/api/sensors/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  ingestSensorPayload: (payload: {
    inverter_id: string;
    adapter_mode?: string;
    transport?: string;
    firmware?: string;
    payload: Record<string, unknown>;
  }) =>
    request<{ ok: boolean; point: TelemetryPoint; prediction: { predictedRulPct: number; predictedStatus: string; confidence?: number } }>(
      '/api/sensors/ingest',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  listSensorStatus: (limit = 200) => request<{ sensors: SensorConnection[]; total: number; connected: number }>(`/api/sensors/status?limit=${limit}`),
  getRealtimeRul: (inverterId: string, limit = 240) =>
    request<{ inverter_id: string; rul: RealtimeRulPoint[] }>(`/api/sensors/${inverterId}/rul?limit=${limit}`),
};
