const CONFIG = {
  port: Number(process.env.PORT || 4000),
  dbPath: process.env.DB_PATH || './relay_predictive.db',
  inverterCount: Number(process.env.INVERTER_COUNT || 5),
  ratedCyclesDefault: Number(process.env.RATED_CYCLES || 100000),
  simulatorIntervalMs: Number(process.env.SIM_INTERVAL_MS || 1000),
  seedHistoryPoints: Number(process.env.SEED_HISTORY_POINTS || 1200),
  trainingSamples: Number(process.env.TRAINING_SAMPLES || 30000),
  sequenceLength: Number(process.env.SEQ_LEN || 12),
  hardwareAdapterMode: process.env.HARDWARE_ADAPTER_MODE || 'stub',
};

module.exports = CONFIG;
