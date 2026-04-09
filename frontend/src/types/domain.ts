export type HealthStatus = 'healthy' | 'warning' | 'critical';

export interface FleetItem {
  inverter_id: string;
  status: HealthStatus;
  predicted_status: HealthStatus;
  cycle_count: number;
  rul_pct_true: number;
  predicted_rul_pct: number;
  temp_c: number;
  current_rms: number;
  voltage_rms: number;
  humidity_pct: number;
  load_pct: number;
  data_origin?: string;
  last_alert: string | null;
  ts: number;
}

export interface TelemetryPoint {
  inverter_id: string;
  ts: number;
  cycle_count: number;
  voltage_rms: number;
  current_rms: number;
  current_peak: number;
  temp_c: number;
  load_pct: number;
  humidity_pct: number;
  arc_ratio: number;
  damage_index: number;
  rul_pct_true: number;
  predicted_rul_pct: number;
  data_origin?: string;
  status: HealthStatus;
}

export interface ModelStats {
  trained: boolean;
  regressionPseudoAccuracy: number;
  regressionMae: number;
  classificationAccuracy: number;
  blendWeight?: number;
  samples: number;
  trainedAt: string;
}

export interface SourceState {
  mode: 'simulation' | 'hardware';
  simulationEnabled: boolean;
  speedMultiplier: number;
  simulatorIntervalMs?: number;
  inverterCount?: number;
  hardwareReady: boolean;
  hardwareAdapterMode?: string;
  sensorIngestionEnabled?: boolean;
}

export interface SensorConnection {
  inverter_id: string;
  connected_at: number;
  last_seen_at: number;
  status: string;
  adapter_mode: string;
  transport: string;
  firmware: string | null;
  metadata_json: string | null;
}

export interface RealtimeRulPoint {
  id?: number;
  inverter_id: string;
  ts: number;
  predicted_rul_pct: number;
  predicted_status: string;
  confidence: number | null;
  source: string;
}

export interface ServiceAlert {
  id: number;
  inverter_id: string;
  created_at: number;
  rul_pct: number;
  temp_c: number;
  status: string;
  priority: string;
  recommended_action: string;
  customer_contact: string | null;
  context_mode: string;
  acknowledged: number;
}

export interface MaintenanceRecommendation {
  inverter_id: string;
  latest: TelemetryPoint | null;
  recommendation: {
    priority: 'low' | 'medium' | 'critical';
    summary: string;
    actions: string[];
  };
}

export interface MaintenanceJob {
  inverter_id: string;
  status: 'unassigned' | 'planned' | 'onsite' | 'completed';
  note: string | null;
  updated_at: number;
  completed_at: number | null;
}

export interface Communication {
  id: number;
  inverter_id: string;
  created_at: number;
  from_role: string;
  to_role: string;
  subject: string;
  message: string;
  severity: string;
  channel: string;
  acknowledged: number;
}
