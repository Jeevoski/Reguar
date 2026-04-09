const { createStubHardwareAdapter } = require('./hardwareAdapterStub');
const { createRealHardwareAdapter } = require('./hardwareAdapterReal');

function createHardwareAdapter({ sampleTelemetry, mode = 'stub' }) {
  const normalizedMode = String(mode || 'stub').toLowerCase();

  if (normalizedMode === 'real') {
    return createRealHardwareAdapter({ sampleTelemetry });
  }

  return createStubHardwareAdapter({ sampleTelemetry });
}

module.exports = {
  createHardwareAdapter,
};
