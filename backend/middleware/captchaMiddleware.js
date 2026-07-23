// backend/middleware/captchaMiddleware.js

const { verifyHumanChallenge } = require("./behavioralCaptcha");

/**
 * Behavioral CAPTCHA verification middleware.
 * Verifies the incoming request using the existing CAPTCHA verification utility.
 * Returns error responses when verification fails, otherwise calls next().
 */
const applyCaptchaCheck = (req, res, next) => {
  if (process.env.ENABLE_BEHAVIORAL_CAPTCHA === 'true') {
    const captchaResult = verifyHumanChallenge(req);

    if (!captchaResult.passed) {
      console.warn(`🛡️ CAPTCHA failed for ${req.ip} on ${req.path}: ${captchaResult.reason}`);

      const statusCode = captchaResult.reason === 'rate_limit_exceeded' ? 429 : 403;
      return res.status(statusCode).json({
        success: false,
        message: captchaResult.reason === 'rate_limit_exceeded'
          ? 'Too many requests. Please slow down.'
          : 'Automated access detected. Please verify you are human.',
        retryAfter: captchaResult.retryAfter || 60,
        score: captchaResult.score
      });
    }
  }
  next();
};

module.exports = { applyCaptchaCheck };