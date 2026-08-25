const prometheus = require('prom-client');

describe('AgentLiabilityService - Prometheus Metrics Registration Idempotency', () => {
    test('should allow safe metric instantiation without duplicate registration errors', () => {
        expect(() => {
            // Require service multiple times to simulate test environment reload
            jest.isolateModules(() => {
                require('../services/agentLiabilityService');
            });
            jest.isolateModules(() => {
                require('../services/agentLiabilityService');
            });
        }).not.toThrow();
    });
});
