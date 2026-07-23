const Pincode = require("../models/Pincode");
const NodeCache = require('node-cache');

const cache = new NodeCache({
    stdTTL: 86400,
    checkperiod: 3600
});

const rateLimiter = new Map();
const RATE_LIMIT_WINDOW = 60000;
const MAX_REQUESTS = 20;

const PINCODE_REGEX = process.env.PINCODE_REGEX || /^\d{6}$/;
const BATCH_MAX_LIMIT = parseInt(process.env.PINCODE_BATCH_LIMIT) || 50;

function validatePincode(pincode) {
    if (!pincode || typeof pincode !== 'string') {
        return { valid: false, message: "Pincode is required" };
    }
    
    const sanitized = pincode.replace(/[^\d]/g, '');
    
    if (!PINCODE_REGEX.test(sanitized)) {
        return { 
            valid: false, 
            message: "Please enter a valid 6-digit pincode."
        };
    }
    
    return { valid: true, sanitized };
}

function checkRateLimit(ip) {
    const now = Date.now();
    const key = `pincode_${ip}`;
    
    if (!rateLimiter.has(key)) {
        rateLimiter.set(key, [now]);
        return true;
    }
    
    const requests = rateLimiter.get(key).filter(
        time => now - time < RATE_LIMIT_WINDOW
    );
    
    if (requests.length >= MAX_REQUESTS) {
        return false;
    }
    
    requests.push(now);
    rateLimiter.set(key, requests);
    return true;
}

function getCacheKey(pincode) {
    return `pincode_${pincode}`;
}

const checkPincode = async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({
            success: false,
            message: "Too many pincode checks. Please try again later."
        });
    }
    
    const { pincode } = req.params;
    const validation = validatePincode(pincode);
    
    if (!validation.valid) {
        return res.status(400).json({
            success: false,
            message: validation.message
        });
    }
    
    const sanitizedPincode = validation.sanitized;
    const cacheKey = getCacheKey(sanitizedPincode);
    
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log(`Cache hit for pincode ${sanitizedPincode}`);
        return res.status(200).json({
            success: true,
            ...cached,
            cached: true
        });
    }
    
    try {
        const results = await Pincode.findByCode(sanitizedPincode);
        
        let responseData;
        
        if (results.length === 0) {
            responseData = {
                deliverable: false,
                message: "Sorry, delivery is not currently available at this pincode."
            };
        } else {
            const { eta_days, city, state } = results[0];
            responseData = {
                deliverable: true,
                eta_days,
                city,
                state,
                message: `Delivery available! Estimated delivery in ${eta_days} day(s) to ${city}, ${state}.`
            };
        }
        
        cache.set(cacheKey, responseData);
        
        console.log(`Pincode check: ${sanitizedPincode} - Deliverable: ${responseData.deliverable}`);
        
        return res.status(200).json({
            success: true,
            ...responseData,
            cached: false
        });
        
    } catch (error) {
        console.error("Pincode check error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
};

const checkMultiplePincodes = async (req, res) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    
    if (!checkRateLimit(clientIp)) {
        return res.status(429).json({
            success: false,
            message: "Too many requests. Please try again later."
        });
    }
    
    const { pincodes } = req.body;
    
    if (!pincodes || !Array.isArray(pincodes) || pincodes.length === 0) {
        return res.status(400).json({
            success: false,
            message: "Please provide an array of pincodes"
        });
    }
    
    if (pincodes.length > BATCH_MAX_LIMIT) {
        return res.status(400).json({
            success: false,
            message: `Maximum ${BATCH_MAX_LIMIT} pincodes allowed per request`
        });
    }
    
    try {
        const results = [];
        const uniquePincodes = [...new Set(pincodes)];
        
        for (const code of uniquePincodes) {
            const validation = validatePincode(code);
            if (!validation.valid) {
                results.push({
                    pincode: code,
                    valid: false,
                    error: validation.message
                });
                continue;
            }
            
            const sanitized = validation.sanitized;
            const cacheKey = getCacheKey(sanitized);
            const cached = cache.get(cacheKey);
            
            if (cached) {
                results.push({
                    pincode: sanitized,
                    ...cached,
                    cached: true
                });
                continue;
            }
            
            const dbResults = await Pincode.findByCode(sanitized);
            
            let responseData;
            if (dbResults.length === 0) {
                responseData = {
                    deliverable: false,
                    message: "Delivery not available at this pincode"
                };
            } else {
                const { eta_days, city, state } = dbResults[0];
                responseData = {
                    deliverable: true,
                    eta_days,
                    city,
                    state,
                    message: `Delivery available in ${eta_days} day(s) to ${city}, ${state}`
                };
            }
            
            cache.set(cacheKey, responseData);
            
            results.push({
                pincode: sanitized,
                ...responseData,
                cached: false
            });
        }
        
        return res.status(200).json({
            success: true,
            data: results,
            total: results.length
        });
        
    } catch (error) {
        console.error("Batch pincode check error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
};

const searchPincodes = async (req, res) => {
    const { query } = req.query;
    
    if (!query || query.length < 3) {
        return res.status(400).json({
            success: false,
            message: "Search query must be at least 3 characters"
        });
    }
    
    try {
        const results = await Pincode.search(query);
        
        return res.status(200).json({
            success: true,
            data: results,
            total: results.length
        });
        
    } catch (error) {
        console.error("Pincode search error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error. Please try again."
        });
    }
};

const clearPincodeCache = async (req, res) => {
    try {
        if (req.user && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: "Unauthorized: Only admins can clear pincode cache"
            });
        }
        
        const cacheSize = cache.keys().length;
        cache.flushAll();
        rateLimiter.clear();
        
        console.log(`Pincode cache cleared: ${cacheSize} entries removed`);
        
        return res.status(200).json({
            success: true,
            message: `Pincode cache cleared successfully (${cacheSize} entries removed)`
        });
        
    } catch (error) {
        console.error("Clear pincode cache error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to clear pincode cache"
        });
    }
};

module.exports = {
    checkPincode,
    checkMultiplePincodes,
    searchPincodes,
    clearPincodeCache
};