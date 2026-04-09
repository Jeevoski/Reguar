const CONFIG = require('./config');

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomNormal(mean = 0, stdDev = 1) {
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdDev + mean;
}

function createInverterState(id, ratedCycles = CONFIG.ratedCyclesDefault, profile = {}) {
  const wearFactor = profile.wearFactor ?? randomBetween(0.75, 1.35);
  const cycleStart = profile.cycle_count ?? Math.floor(randomBetween(2000, 45000));
  return {
    inverter_id: id,
    ratedCycles,
    wearFactor,
    cycle_count: cycleStart,
    voltage_rms: profile.voltage_rms ?? randomBetween(224, 236),
    current_rms: profile.current_rms ?? randomBetween(5, 10),
    current_peak: profile.current_peak ?? randomBetween(10, 16),
    temp_c: profile.temp_c ?? randomBetween(27, 40),
    load_pct: profile.load_pct ?? randomBetween(25, 75),
    humidity_pct: profile.humidity_pct ?? randomBetween(45, 75),
    spike_count: profile.spike_count ?? Math.floor(randomBetween(0, 8)),
    temp_integral: 0,
    damage_index: 0,
    inducedStressBoost: 0,
    last_alert: null,
  };
}

function computeStressFactor({ temp_c, load_pct, humidity_pct, spike_count, inducedStressBoost }) {
  const base = temp_c / 50 + load_pct / 100 + humidity_pct / 180;
  const spike = spike_count * 0.018;
  return clamp(base + spike + inducedStressBoost, 0.5, 6.5);
}

function computeTrueRulPct(cycleCount, ratedCycles, stressFactor) {
  const shape = 2;
  const scale = ratedCycles / Math.max(stressFactor, 0.3);
  const survival = Math.exp(-Math.pow(cycleCount / Math.max(scale, 1), shape));
  const rul = ratedCycles * survival;
  const rulPct = (rul / ratedCycles) * 100;
  return clamp(rulPct, 0, 100);
}

function classifyByRul(rulPct) {
  if (rulPct < 25) {
    return 'critical';
  }
  if (rulPct < 50) {
    return 'warning';
  }
  return 'healthy';
}

function updateOneStep(state, simulationSpeed = 1) {
  const switchEvent = Math.random() < 0.2 * Math.max(1, simulationSpeed * 0.7);
  const jumpCycles = Math.floor(randomBetween(4, 35) * simulationSpeed * state.wearFactor);
  state.cycle_count = clamp(state.cycle_count + jumpCycles, 0, state.ratedCycles * 1.2);

  state.load_pct = clamp(state.load_pct + randomNormal(0.5, 4.5), 20, 100);
  state.humidity_pct = clamp(state.humidity_pct + randomNormal(0, 1.8), 40, 90);
  state.voltage_rms = clamp(230 + randomNormal(0, 4), 220, 240);

  const baseCurrent = 5 + (state.load_pct / 100) * 15;
  state.current_rms = clamp(baseCurrent + randomNormal(0, 1.1), 5, 20);

  const switchingSpike = switchEvent ? randomBetween(4, 11) : randomBetween(0.5, 2.5);
  state.current_peak = clamp(state.current_rms + switchingSpike, state.current_rms + 0.5, 33);
  state.spike_count = switchEvent ? state.spike_count + 1 : Math.max(0, state.spike_count - 1);

  const cycleHeat = state.cycle_count / state.ratedCycles;
  const thermalRise = state.load_pct * 0.05 + cycleHeat * 9 + randomNormal(0, 1.5);
  state.temp_c = clamp(24 + thermalRise, 25, 80);

  state.temp_integral += state.temp_c * (CONFIG.simulatorIntervalMs / 1000) * simulationSpeed;

  const arc_ratio = state.current_peak / Math.max(state.current_rms, 0.1);
  const stress_factor = computeStressFactor(state);
  const rul_pct_true = computeTrueRulPct(state.cycle_count, state.ratedCycles, stress_factor);

  state.damage_index = clamp(
    0.35 * (state.cycle_count / state.ratedCycles) +
      0.3 * (state.temp_c / 80) +
      0.2 * (state.load_pct / 100) +
      0.15 * ((arc_ratio - 1) / 2),
    0,
    2
  );

  const status = classifyByRul(rul_pct_true);

  if (state.inducedStressBoost > 0) {
    state.inducedStressBoost = Math.max(0, state.inducedStressBoost - 0.02 * simulationSpeed);
  }

  return {
    inverter_id: state.inverter_id,
    ts: Date.now(),
    cycle_count: state.cycle_count,
    voltage_rms: Number(state.voltage_rms.toFixed(2)),
    current_rms: Number(state.current_rms.toFixed(2)),
    current_peak: Number(state.current_peak.toFixed(2)),
    temp_c: Number(state.temp_c.toFixed(2)),
    load_pct: Number(state.load_pct.toFixed(2)),
    humidity_pct: Number(state.humidity_pct.toFixed(2)),
    spike_count: state.spike_count,
    stress_factor: Number(stress_factor.toFixed(4)),
    temp_integral: Number(state.temp_integral.toFixed(2)),
    arc_ratio: Number(arc_ratio.toFixed(4)),
    damage_index: Number(state.damage_index.toFixed(4)),
    rul_pct_true: Number(rul_pct_true.toFixed(2)),
    predicted_rul_pct: null,
    status,
  };
}

function induceFailure(inverterState, mode = 'thermal') {
  if (mode === 'thermal') {
    inverterState.temp_c = clamp(inverterState.temp_c + randomBetween(12, 20), 25, 80);
    inverterState.load_pct = clamp(inverterState.load_pct + randomBetween(20, 35), 20, 100);
    inverterState.inducedStressBoost += 0.8;
  } else if (mode === 'electrical') {
    inverterState.current_peak = clamp(inverterState.current_peak + randomBetween(8, 15), 0, 35);
    inverterState.spike_count += Math.floor(randomBetween(8, 20));
    inverterState.inducedStressBoost += 1.2;
  } else {
    inverterState.cycle_count = clamp(
      inverterState.cycle_count + Math.floor(randomBetween(3000, 7000)),
      0,
      inverterState.ratedCycles * 1.2
    );
    inverterState.inducedStressBoost += 0.6;
  }
}

module.exports = {
  createInverterState,
  updateOneStep,
  induceFailure,
  classifyByRul,
};
