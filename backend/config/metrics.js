// backend/config/metrics.js
//
// Thin Prometheus facade with lazily-created metrics.
//
// Two defects fixed in #1341:
//
// 1. **Every call threw.** Callers use dotted names -- `metrics.increment(
//    'audit.session_started')`, `'db_operation.retry'`, `'cache.hit'` -- but a
//    Prometheus metric name must match /^[a-zA-Z_:][a-zA-Z0-9_:]*$/. A dot is
//    not in that set, so `new prometheus.Counter({ name: 'audit_audit.session_started' })`
//    threw `Invalid metric name` on the first call for each name. Names are now
//    normalised, so a dotted call site becomes `audit_audit_session_started`.
//
// 2. **A throw here took the caller down with it.** aiAuditTrailService calls
//    these helpers from inside `startSession`, `logDecision` and friends,
//    mostly outside the try. The registry throwing therefore failed the audit
//    write itself. Instrumentation must never be able to fail the operation it
//    is measuring, so every helper now swallows and reports its own errors.

const prometheus = require('prom-client');

// Create a Registry.
const register = new prometheus.Registry();

// Add default metrics.
prometheus.collectDefaultMetrics({
    register,
    prefix: 'audit_'
});

/** Prometheus' own rule for what a metric name may contain. */
const VALID_METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;

/**
 * Turn an arbitrary call-site name into a legal Prometheus metric name.
 *
 * Dots and dashes -- the separators callers actually use -- become
 * underscores; anything else illegal is dropped the same way. A leading digit
 * is prefixed, since a name may not start with one.
 *
 * @param {string} name
 * @returns {string}
 */
function normalizeMetricName(name) {
    const normalized = String(name)
        .trim()
        .replace(/[^a-zA-Z0-9_:]/g, '_')
        .replace(/_{2,}/g, '_');

    const prefixed = `audit_${normalized}`;
    return VALID_METRIC_NAME.test(prefixed) ? prefixed : `audit_invalid_${Date.now()}`;
}

/**
 * Run an instrumentation call without letting it escape.
 *
 * @param {string} operation for the diagnostic line
 * @param {Function} fn
 */
function safely(operation, fn) {
    try {
        fn();
    } catch (error) {
        // console rather than the winston logger: config/logger requires this
        // module in some builds, and a cycle here would be worse than a plain
        // line on stderr.
        console.error(`metrics.${operation} failed:`, error.message);
    }
}

const metrics = {
    /**
     * Increment a counter, creating it on first use.
     */
    increment: (name, value = 1) => {
        safely('increment', () => {
            if (!metrics._counters[name]) {
                metrics._counters[name] = new prometheus.Counter({
                    name: normalizeMetricName(name),
                    help: `Audit ${name} counter`,
                    registers: [register]
                });
            }
            metrics._counters[name].inc(value);
        });
    },

    /**
     * Observe a value on a histogram, creating it on first use.
     */
    histogram: (name, value) => {
        safely('histogram', () => {
            if (!metrics._histograms[name]) {
                metrics._histograms[name] = new prometheus.Histogram({
                    name: normalizeMetricName(name),
                    help: `Audit ${name} histogram`,
                    buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
                    registers: [register]
                });
            }
            metrics._histograms[name].observe(value);
        });
    },

    /**
     * Set a gauge, creating it on first use.
     */
    gauge: (name, value) => {
        safely('gauge', () => {
            if (!metrics._gauges[name]) {
                metrics._gauges[name] = new prometheus.Gauge({
                    name: normalizeMetricName(name),
                    help: `Audit ${name} gauge`,
                    registers: [register]
                });
            }
            metrics._gauges[name].set(value);
        });
    },

    /**
     * Current value of a counter.
     *
     * prom-client has no synchronous `.value()`; the value lives on the
     * metric's internal hash map. The old implementation called a method that
     * does not exist, so this threw for every name that had been registered and
     * silently returned 0 for every name that had not.
     */
    getCounter: (name) => {
        const counter = metrics._counters[name];
        if (!counter) return 0;

        try {
            const values = Object.values(counter.hashMap || {});
            return values.reduce((sum, entry) => sum + (entry.value || 0), 0);
        } catch (error) {
            console.error('metrics.getCounter failed:', error.message);
            return 0;
        }
    },

    /**
     * Drop every lazily-created metric. Used between test cases so counters do
     * not leak across suites.
     */
    reset: () => {
        safely('reset', () => {
            Object.values(metrics._counters).forEach((m) => register.removeSingleMetric(m.name));
            Object.values(metrics._histograms).forEach((m) => register.removeSingleMetric(m.name));
            Object.values(metrics._gauges).forEach((m) => register.removeSingleMetric(m.name));
            metrics._counters = {};
            metrics._histograms = {};
            metrics._gauges = {};
        });
    },

    // Internal storage
    _counters: {},
    _histograms: {},
    _gauges: {}
};

// Export register for the /metrics endpoint.
metrics.register = register;
metrics.normalizeMetricName = normalizeMetricName;

module.exports = metrics;
