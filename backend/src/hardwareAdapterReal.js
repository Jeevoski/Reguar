function createRealHardwareAdapter({ sampleTelemetry }) {
  if (typeof sampleTelemetry !== 'function') {
    throw new Error('sampleTelemetry(state, speed) function is required');
  }

  // Placeholder for real hardware integration using modbus-serial + GPIO drivers.
  // Keep same interface as stub adapter so server code does not change.
  function readModbusRegisters(state, speed = 1) {
    const telemetryFallback = sampleTelemetry(state, speed);
    return {
      telemetry: telemetryFallback,
      registers: {
        3002: Math.round(telemetryFallback.current_rms * 100),
        3019: Math.round(telemetryFallback.temp_c * 10),
        3008: Math.round(telemetryFallback.voltage_rms * 10),
        3025: telemetryFallback.cycle_count,
      },
      source: 'real-placeholder',
      integrationTodo: 'Replace fallback with modbus-serial client.readHoldingRegisters(...) calls.',
    };
  }

  function readAcs712(state, speed = 1) {
    const telemetryFallback = sampleTelemetry(state, speed);
    return {
      current_a: telemetryFallback.current_rms,
      peak_a: telemetryFallback.current_peak,
      timestamp: telemetryFallback.ts,
      inverter_id: telemetryFallback.inverter_id,
      source: 'real-placeholder',
      integrationTodo: 'Read ACS712 via ADC on Raspberry Pi and calibrate offset/sensitivity.',
      telemetry: telemetryFallback,
    };
  }

  function readDht22(state, speed = 1) {
    const telemetryFallback = sampleTelemetry(state, speed);
    return {
      temp_c: telemetryFallback.temp_c,
      humidity_pct: telemetryFallback.humidity_pct,
      timestamp: telemetryFallback.ts,
      inverter_id: telemetryFallback.inverter_id,
      source: 'real-placeholder',
      integrationTodo: 'Replace with real DHT22 library read values.',
      telemetry: telemetryFallback,
    };
  }

  function readHallCycles(state, speed = 1) {
    const telemetryFallback = sampleTelemetry(state, speed);
    return {
      cycle_count: telemetryFallback.cycle_count,
      timestamp: telemetryFallback.ts,
      inverter_id: telemetryFallback.inverter_id,
      source: 'real-placeholder',
      integrationTodo: 'Replace with GPIO pulse counter from hall/reed switch.',
      telemetry: telemetryFallback,
    };
  }

  function readIna219(state, speed = 1) {
    const telemetryFallback = sampleTelemetry(state, speed);
    return {
      voltage_v: telemetryFallback.voltage_rms,
      timestamp: telemetryFallback.ts,
      inverter_id: telemetryFallback.inverter_id,
      source: 'real-placeholder',
      integrationTodo: 'Replace with INA219 I2C measurement read.',
      telemetry: telemetryFallback,
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
      adapterMode: 'real',
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
      note: 'Real adapter placeholder active. Install modbus-serial and sensor drivers for Raspberry Pi.',
      integration: {
        modbusSerial: 'pending',
        acs712: 'pending',
        dht22: 'pending',
        hallCounter: 'pending',
        ina219: 'pending',
      },
    };
  }

  return {
    mode: 'real',
    readModbusRegisters,
    readAcs712,
    readDht22,
    readHallCycles,
    readIna219,
    readSensors,
  };
}

module.exports = {
  createRealHardwareAdapter,
};
