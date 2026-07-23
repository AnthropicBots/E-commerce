// backend/middleware/refundFraudMiddleware.js
const aiImageDetection = require('../services/aiImageDetectionService');
const db = require('../config/db').promise;
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '../uploads/refund_evidence'));
    },
    filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${unique}-${file.originalname}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/quicktime'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
}).array('evidence', 5); // Max 5 files

/**
 * Middleware to detect AI-generated evidence
 */
async function detectAIGeneratedEvidence(req, res, next) {
    try {
        const { files, body } = req;

        if (!files || files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No evidence files provided'
            });
        }

        const detectionResults = [];

        for (const file of files) {
            const fileBuffer = file.buffer || fs.readFileSync(file.path);
            
            // Detect AI-generated images
            const metadata = {
                fileName: file.originalname,
                size: file.size,
                mimeType: file.mimetype,
                createDate: file.birthtime || new Date(),
                modifyDate: file.mtime || new Date()
            };

            const result = await aiImageDetection.detectAIImage(fileBuffer, metadata);
            detectionResults.push({
                file: file.originalname,
                ...result
            });

            // If AI-generated, log and flag
            if (result.isAIGenerated) {
                await db.query(
                    `INSERT INTO refund_fraud_alerts 
                     (user_id, order_id, file_name, confidence, flags, timestamp)
                     VALUES (?, ?, ?, ?, ?, NOW())`,
                    [
                        req.user.id,
                        body.orderId,
                        file.originalname,
                        result.confidence,
                        JSON.stringify(result.flags)
                    ]
                );

                // Send alert if critical
                if (result.confidence > 85) {
                    console.error(`🚨 CRITICAL: AI-generated evidence detected! User: ${req.user.id}, File: ${file.originalname}`);
                    // Send email/slack notification
                }
            }
        }

        // Check if any files are AI-generated
        const aiGeneratedFiles = detectionResults.filter(r => r.isAIGenerated);
        
        if (aiGeneratedFiles.length > 0) {
            return res.status(403).json({
                success: false,
                error: 'AI-generated evidence detected',
                details: aiGeneratedFiles.map(r => ({
                    file: r.file,
                    confidence: r.confidence,
                    flags: r.flags
                })),
                blocked: true
            });
        }

        req.detectionResults = detectionResults;
        next();
    } catch (error) {
        console.error('Fraud detection error:', error);
        next(error);
    }
}

/**
 * Middleware to validate video evidence
 */
async function validateVideoEvidence(req, res, next) {
    try {
        const { files, body } = req;
        const videos = files.filter(f => f.mimetype.startsWith('video/'));

        if (videos.length === 0) {
            // No videos, but images are still allowed
            return next();
        }

        const videoValidation = [];

        for (const video of videos) {
            const validation = await aiImageDetection.validateVideo(
                video.path,
                body.angles ? body.angles.split(',') : []
            );

            videoValidation.push({
                file: video.originalname,
                ...validation
            });

            if (!validation.isValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Video validation failed',
                    details: validation.errors,
                    file: video.originalname
                });
            }
        }

        req.videoValidation = videoValidation;
        next();
    } catch (error) {
        console.error('Video validation error:', error);
        next(error);
    }
}

/**
 * Middleware to generate tamper-evident QR code
 */
async function generateTamperEvidence(req, res, next) {
    try {
        const { body } = req;
        const qrData = aiImageDetection.generateQRCode({
            orderId: body.orderId,
            productId: body.productId,
            userId: req.user.id
        });

        // Store QR code in database
        await db.query(
            `INSERT INTO tamper_evidence_logs 
             (order_id, product_id, user_id, qr_data, timestamp)
             VALUES (?, ?, ?, ?, NOW())`,
            [
                body.orderId,
                body.productId,
                req.user.id,
                JSON.stringify(qrData)
            ]
        );

        req.qrData = qrData;
        next();
    } catch (error) {
        console.error('QR code generation error:', error);
        next(error);
    }
}

/**
 * Middleware to verify tamper-evident QR code
 */
async function verifyTamperEvidence(req, res, next) {
    try {
        const { qrData } = req.body;

        if (!qrData) {
            return res.status(400).json({
                success: false,
                error: 'QR code data required'
            });
        }

        const [existing] = await db.query(
            'SELECT * FROM tamper_evidence_logs WHERE qr_data = ?',
            [JSON.stringify(qrData)]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'QR code not found'
            });
        }

        const verification = aiImageDetection.verifyQRCode(qrData);

        if (!verification.valid) {
            return res.status(403).json({
                success: false,
                error: 'Tamper evidence verification failed',
                reason: verification.reason
            });
        }

        req.qrVerification = verification;
        next();
    } catch (error) {
        console.error('QR verification error:', error);
        next(error);
    }
}

module.exports = {
    detectAIGeneratedEvidence,
    validateVideoEvidence,
    generateTamperEvidence,
    verifyTamperEvidence,
    upload
};