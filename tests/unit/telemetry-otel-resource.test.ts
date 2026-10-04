import { describe, expect, it } from 'vitest';
import { TelemetryService } from '../../services/telemetry/src/telemetry.service.js';

describe('TelemetryService OpenTelemetry resource', () => {
  it('starts and shuts down with the v2 resource API', async () => {
    const telemetry = new TelemetryService({
      serviceName: 'dmrx-telemetry-test',
      enableMetrics: false,
      enableTracing: false,
    });

    expect(telemetry.isStarted()).toBe(false);
    try {
      await telemetry.start();
      expect(telemetry.isStarted()).toBe(true);
    } finally {
      await telemetry.shutdown();
    }
    expect(telemetry.isStarted()).toBe(false);
  });
});
