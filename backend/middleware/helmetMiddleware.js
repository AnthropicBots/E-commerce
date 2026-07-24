const helmet = require("helmet");

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5500";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5000";
const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

const helmetMiddleware = helmet({
    crossOriginEmbedderPolicy: false,
    
    crossOriginResourcePolicy: {
        policy: "cross-origin"
    },
    
    crossOriginOpenerPolicy: {
        policy: "same-origin"
    },
    
    dnsPrefetchControl: {
        allow: false
    },
    
    frameguard: {
        action: "deny"
    },
    
    hidePoweredBy: true,
    
    hsts: isProduction ? {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    } : false,
    
    ieNoOpen: true,
    
    noSniff: true,
    
    referrerPolicy: {
        policy: "strict-origin-when-cross-origin"
    },
    
    xssFilter: true,
    
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://www.gstatic.com",
                "https://apis.google.com",
                "https://cdnjs.cloudflare.com",
                "https://js.stripe.com",
                "https://cdn.jsdelivr.net"
            ],
            
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net"
            ],
            
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net"
            ],
            
            imgSrc: [
                "'self'",
                "data:",
                "https:",
                "http:",
                "https://ui-avatars.com",
                "https://encrypted-tbn0.gstatic.com"
            ],
            
            connectSrc: [
                "'self'",
                FRONTEND_URL,
                BACKEND_URL,
                "https://api.stripe.com",
                "https://maps.googleapis.com",
                "https://www.googleapis.com"
            ],
            
            frameSrc: [
                "'self'",
                "https://js.stripe.com",
                "https://www.google.com"
            ],
            
            objectSrc: ["'none'"],
            
            baseUri: ["'self'"],
            
            formAction: ["'self'"],
            
            frameAncestors: ["'none'"],
            
            upgradeInsecureRequests: isProduction ? true : null,
            
            reportUri: isProduction ? "/api/csp-report" : null
        },
        
        reportOnly: !isProduction
    },
    
    originAgentCluster: true,
    
    permittedCrossDomainPolicies: {
        permittedPolicies: "none"
    }
});

function addSecurityHeaders(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    
    if (isProduction) {
        res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    
    res.setHeader("Permissions-Policy", 
        "geolocation=(), " +
        "microphone=(), " +
        "camera=(), " +
        "payment=(), " +
        "usb=(), " +
        "battery=(), " +
        "midi=(), " +
        "accelerometer=(), " +
        "gyroscope=(), " +
        "magnetometer=(), " +
        "ambient-light-sensor=(), " +
        "encrypted-media=()"
    );
    
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    
    next();
}

async function handleCspReport(req, res) {
    try {
        const report = req.body;
        console.warn("CSP Violation Report:", JSON.stringify(report, null, 2));
        
        if (report && report["csp-report"]) {
            const violation = report["csp-report"];
            const logEntry = {
                timestamp: new Date().toISOString(),
                blockedUri: violation["blocked-uri"],
                documentUri: violation["document-uri"],
                violatedDirective: violation["violated-directive"],
                effectiveDirective: violation["effective-directive"],
                originalPolicy: violation["original-policy"],
                sourceFile: violation["source-file"],
                lineNumber: violation["line-number"],
                columnNumber: violation["column-number"],
                scriptSample: violation["script-sample"],
                userAgent: req.headers["user-agent"],
                ip: req.ip
            };
            
            console.warn("CSP Violation:", logEntry);
        }
        
        res.status(204).end();
    } catch (error) {
        console.error("CSP Report Error:", error);
        res.status(204).end();
    }
}

module.exports = {
    helmetMiddleware,
    addSecurityHeaders,
    handleCspReport
};