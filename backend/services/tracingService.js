// backend/services/tracingService.js
const { trace, SpanStatusCode, diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { MySQLInstrumentation } = require('@opentelemetry/instrumentation-mysql2');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');

// ============================================
// TRACING CONFIGURATION
// ============================================

const TRACING_CONFIG = {
    serviceName: process.env.OTEL_SERVICE_NAME || 'ecommerce-backend',
    serviceVersion: process.env.OTEL_SERVICE_VERSION || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    exporterEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/traces',
    samplingRatio: parseFloat(process.env.OTEL_SAMPLING_RATIO) || 1.0,
    maxAttributes: 1000,
    maxEvents: 1000,
    maxLinks: 1000
};

// ============================================
// TRACING SERVICE
// ============================================

class TracingService {
    constructor() {
        this.provider = null;
        this.tracer = null;
        this.initialized = false;
        this.spans = new Map();
        this.activeSpans = new Map();
    }

    /**
     * Initialize OpenTelemetry tracing
     */
    async initialize() {
        if (this.initialized) return;

        try {
            // Set up diagnostics
            diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);

            // Create resource
            const resource = new Resource({
                [SemanticResourceAttributes.SERVICE_NAME]: TRACING_CONFIG.serviceName,
                [SemanticResourceAttributes.SERVICE_VERSION]: TRACING_CONFIG.serviceVersion,
                [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: TRACING_CONFIG.environment,
            });

            // Create tracer provider
            this.provider = new NodeTracerProvider({
                resource,
                sampler: {
                    shouldSample: (context, traceId, spanName, spanKind, attributes, links) => {
                        return TRACING_CONFIG.samplingRatio;
                    }
                }
            });

            // Set up exporter
            const exporter = new OTLPTraceExporter({
                url: TRACING_CONFIG.exporterEndpoint,
                concurrencyLimit: 10,
            });

            // Add span processor
            const spanProcessor = new BatchSpanProcessor(exporter, {
                maxQueueSize: 1000,
                maxExportBatchSize: 100,
                scheduledDelayMillis: 5000,
                exportTimeoutMillis: 30000,
            });

            this.provider.addSpanProcessor(spanProcessor);
            this.provider.register();

            // Get tracer
            this.tracer = this.provider.getTracer(
                TRACING_CONFIG.serviceName,
                TRACING_CONFIG.serviceVersion
            );

            // Register instrumentations
            this.registerInstrumentations();

            // Store global tracer
            global._tracer = this.tracer;

            this.initialized = true;
            console.log('✅ OpenTelemetry Tracing initialized');
            console.log(`📡 Exporting traces to: ${TRACING_CONFIG.exporterEndpoint}`);

            return this;
        } catch (error) {
            console.error('Failed to initialize tracing:', error);
            throw error;
        }
    }

    /**
     * Register instrumentations
     */
    registerInstrumentations() {
        registerInstrumentations({
            tracerProvider: this.provider,
            instrumentations: [
                new ExpressInstrumentation({
                    enabled: true,
                    ignoreLayers: ['middleware'],
                    ignorePaths: ['/health', '/metrics', '/favicon.ico'],
                }),
                new HttpInstrumentation({
                    enabled: true,
                    ignoreIncomingPaths: ['/health', '/metrics'],
                    ignoreOutgoingUrls: [/localhost:4318/],
                }),
                new MySQLInstrumentation({
                    enabled: true,
                    enhancedDatabaseReporting: true,
                }),
            ],
        });
    }

    /**
     * Create a span
     */
    createSpan(name, options = {}) {
        if (!this.tracer) {
            console.warn('Tracing not initialized, creating span without tracing');
            return this.createNoopSpan(name);
        }

        const span = this.tracer.startSpan(name, {
            ...options,
            attributes: {
                ...options.attributes,
                'service.name': TRACING_CONFIG.serviceName,
                'service.version': TRACING_CONFIG.serviceVersion,
                'environment': TRACING_CONFIG.environment,
                ...(options.attributes || {})
            }
        });

        return span;
    }

    /**
     * Create a no-op span (fallback)
     */
    createNoopSpan(name) {
        return {
            name,
            attributes: {},
            events: [],
            status: { code: 0 },
            end: () => {},
            setAttribute: () => {},
            setAttributes: () => {},
            addEvent: () => {},
            setStatus: () => {},
            recordException: () => {},
        };
    }

    /**
     * Start a span with automatic ending
     */
    async startSpan(name, fn, options = {}) {
        const span = this.createSpan(name, options);
        const context = trace.setSpan(trace.contextWithSpanId(), span);

        try {
            const result = await fn(span, context);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
            throw error;
        } finally {
            span.end();
        }
    }

    /**
     * Start a child span
     */
    startChildSpan(parentSpan, name, options = {}) {
        if (!parentSpan || !this.tracer) {
            return this.createNoopSpan(name);
        }

        const childSpan = this.tracer.startSpan(name, {
            ...options,
            parent: trace.setSpan(trace.contextWithSpanId(), parentSpan),
            attributes: {
                ...options.attributes,
                'parent.span': parentSpan.name,
            }
        });

        return childSpan;
    }

    /**
     * End a span with status
     */
    endSpan(span, status = SpanStatusCode.OK, message = null) {
        if (!span) return;

        if (message) {
            span.setStatus({ code: status, message });
        } else {
            span.setStatus({ code: status });
        }

        span.end();
    }

    /**
     * Record an error on a span
     */
    recordError(span, error, additionalAttributes = {}) {
        if (!span) return;

        span.recordException(error);
        span.setStatus({ 
            code: SpanStatusCode.ERROR, 
            message: error.message || 'Unknown error' 
        });

        if (additionalAttributes) {
            span.setAttributes(additionalAttributes);
        }
    }

    /**
     * Add event to span
     */
    addEvent(span, name, attributes = {}) {
        if (!span) return;
        span.addEvent(name, attributes);
    }

    // ============================================
    // TRACE CONTEXT HELPERS
    // ============================================

    /**
     * Get current span from context
     */
    getCurrentSpan() {
        try {
            return trace.getActiveSpan();
        } catch (error) {
            return null;
        }
    }

    /**
     * Get trace context from headers
     */
    getTraceContext(req) {
        const headers = {
            'traceparent': req.headers['traceparent'],
            'tracestate': req.headers['tracestate'],
        };

        return headers;
    }

    /**
     * Get trace ID from current span
     */
    getTraceId() {
        const span = this.getCurrentSpan();
        if (!span) return null;

        try {
            const spanContext = span.spanContext();
            return spanContext.traceId;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get span ID from current span
     */
    getSpanId() {
        const span = this.getCurrentSpan();
        if (!span) return null;

        try {
            const spanContext = span.spanContext();
            return spanContext.spanId;
        } catch (error) {
            return null;
        }
    }

    // ============================================
    // SPAN MANAGEMENT
    // ============================================

    /**
     * Start a new trace for a request
     */
    startRequestTrace(req, res, next) {
        const span = this.createSpan(`HTTP ${req.method} ${req.path}`, {
            attributes: {
                'http.method': req.method,
                'http.url': req.url,
                'http.path': req.path,
                'http.user_agent': req.headers['user-agent'] || '',
                'http.client_ip': req.ip || req.connection?.remoteAddress || 'unknown',
            }
        });

        // Store span in request
        req._span = span;
        req._startTime = Date.now();

        // Track active span
        this.activeSpans.set(req.id || Date.now(), span);

        next();
    }

    /**
     * End request trace
     */
    endRequestTrace(req, res) {
        const span = req._span;
        if (!span) return;

        const duration = Date.now() - (req._startTime || Date.now());

        span.setAttributes({
            'http.status_code': res.statusCode,
            'http.duration_ms': duration,
            'http.response_size': res.getHeader('content-length') || 0,
        });

        if (res.statusCode >= 400) {
            span.setStatus({ 
                code: SpanStatusCode.ERROR, 
                message: `HTTP ${res.statusCode}` 
            });
        } else {
            span.setStatus({ code: SpanStatusCode.OK });
        }

        span.end();

        // Remove from active spans
        this.activeSpans.delete(req.id || Date.now());
    }

    // ============================================
    // DATABASE TRACING
    // ============================================

    /**
     * Trace a database query
     */
    async traceQuery(query, params = [], options = {}) {
        const span = this.createSpan(`DB Query: ${options.operation || 'unknown'}`, {
            attributes: {
                'db.system': 'mysql',
                'db.operation': options.operation || 'query',
                'db.statement': query.substring(0, 1000),
                'db.parameters': JSON.stringify(params),
                ...(options.attributes || {})
            }
        });

        try {
            const result = await options.fn(query, params);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
        } catch (error) {
            this.recordError(span, error);
            throw error;
        } finally {
            span.end();
        }
    }

    // ============================================
    // SHUTDOWN
    // ============================================

    async shutdown() {
        if (this.provider) {
            try {
                await this.provider.shutdown();
                console.log('✅ Tracing provider shut down');
            } catch (error) {
                console.error('Error shutting down tracing:', error);
            }
        }
    }
}

// ============================================
// EXPORT
// ============================================

module.exports = {
    TracingService,
    tracingService: new TracingService(),
    trace,
    SpanStatusCode
};