function createStubHardwareAdapter({ sampleTelemetry }) {
  if (typeof sampleTelemetry !== 'function') {
    throw new Error('sampleTelemetry(state, speed) function is required');
  }

  function readModbusRegisters(state, speed = 1) {
    const telemetry = sampleTelemetry(state, speed);
    return {
      telemetry,
      registers: {
        3002: Math.round(telemetry.current_rms * 100),
        3019: Math.round(telemetry.temp_c * 10),
        3008: Math.round(telemetry.voltage_rms * 10),
        3025: telemetry.cycle_count,
      },
    };
  }

  function readAcs712(state, speed = 1) {
    const telemetry = sampleTelemetry(state, speed);
    return {
      current_a: telemetry.current_rms,
      peak_a: telemetry.current_peak,
      timestamp: telemetry.ts,
      inverter_id: telemetry.inverter_id,
      telemetry,
    };
  }

  function readDht22(state, speed = 1) {
    const telemetry = sampleTelemetry(state, speed);
    return {
      temp_c: telemetry.temp_c,
      humidity_pct: telemetry.humidity_pct,
      timestamp: telemetry.ts,
      inverter_id: telemetry.inverter_id,
      telemetry,
    };
  }

  function readHallCycles(state, speed = 1) {
    const telemetry = sampleTelemetry(state, speed);
    return {
      cycle_count: telemetry.cycle_count,
      timestamp: telemetry.ts,
      inverter_id: telemetry.inverter_id,
      telemetry,
    };
  }

  function readIna219(state, speed = 1) {
    const telemetry = sampleTelemetry(state, speed);
    return {
      voltage_v: telemetry.voltage_rms,
      timestamp: telemetry.ts,
      inverter_id: telemetry.inverter_id,
      telemetry,
    };
  }

  function readSensors(state, speed = 1) {
    const modbus = readModbusRegisters(state, speed);
    const acs = readAcs712(state, speed);
    const dht = readDht22(state, speed);
    const hall = readHallCycles(state, speed);
    const ina = readIna219(state, speed);

    return {
      mode: 'hardware',
      adapterMode: 'stub',
      inverter_id: modbus.telemetry.inverter_id,
      timestamp: modbus.telemetry.ts,
      registers: modbus.registers,
      sensors: {
        acs712_current_a: acs.current_a,
        acs712_peak_a: acs.peak_a,
        dht22_temp_c: dht.temp_c,
        dht22_humidity_pct: dht.humidity_pct,
        hall_cycles: hall.cycle_count,
        ina219_voltage_v: ina.voltage_v,
      },
      telemetry: modbus.telemetry,
      note: 'Stub payload. Swap implementation with modbus-serial + GPIO sensor drivers on Raspberry Pi.',
    };
  }

  return {
    mode: 'stub',
    readModbusRegisters,
    readAcs712,
    readDht22,
    readHallCycles,
    readIna219,
    readSensors,
  };
}

module.exports = {
  createStubHardwareAdapter,
};
