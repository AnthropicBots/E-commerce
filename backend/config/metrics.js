// backend/config/metrics.js
const prometheus = require('prom-client');

// Create a Registry
const register = new prometheus.Registry();

// Add default metrics
prometheus.collectDefaultMetrics({
    register,
    prefix: 'audit_'
});

// Custom metrics
const metrics = {
    // Counter metrics
    increment: (name, value = 1) => {
        if (!metrics._counters[name]) {
            metrics._counters[name] = new prometheus.Counter({
                name: `audit_${name}`,
                help: `Audit ${name} counter`,
                registers: [register]
            });
        }
        metrics._counters[name].inc(value);
    },

    // Histogram metrics
    histogram: (name, value) => {
        if (!metrics._histograms[name]) {
            metrics._histograms[name] = new prometheus.Histogram({
                name: `audit_${name}`,
                help: `Audit ${name} histogram`,
                buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
                registers: [register]
            });
        }
        metrics._histograms[name].observe(value);
    },

    // Gauge metrics
    gauge: (name, value) => {
        if (!metrics._gauges[name]) {
            metrics._gauges[name] = new prometheus.Gauge({
                name: `audit_${name}`,
                help: `Audit ${name} gauge`,
                registers: [register]
            });
        }
        metrics._gauges[name].set(value);
    },

    // Get counter value
    getCounter: (name) => {
        if (metrics._counters[name]) {
            return metrics._counters[name].value();
        }
        return 0;
    },

    // Internal storage
    _counters: {},
    _histograms: {},
    _gauges: {}
};

// Export register for API endpoint
metrics.register = register;

module.exports = metrics;