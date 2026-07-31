const { sanitizeString } = require("../utils/helpers");
const { isValidEmail, isValidOTP, validatePassword } = require("../utils/validators");

/**
 * Helper to check for missing required fields.
 * Returns an array of missing field names.
 */
const getMissingFields = (req, fields) => {
  return fields.filter(field => !sanitizeString(req.body[field]));
};

// ==================== VALIDATION MIDDLEWARES ====================

const validateSignup = (req, res, next) => {
  const { name, email, password, age } = req.body;

  const missing = getMissingFields(req, ['name', 'email', 'password']);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} is/are required` });
  }

  if (name.length < 2) {
    return res.status(400).json({ success: false, message: "Name must be at least 2 characters long" });
  }

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.isValid) {
    return res.status(400).json({ success: false, message: passwordCheck.message });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Invalid email format" });
  }

  if (age && (age < 18 || age > 100)) {
    return res.status(400).json({ success: false, message: "Age must be between 18 and 100" });
  }

  next();
};

const validateVerifySignup = (req, res, next) => {
  const { email, otp } = req.body;

  const missing = getMissingFields(req, ['email', 'otp']);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} is/are required` });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Invalid email format" });
  }

  if (!isValidOTP(otp)) {
    return res.status(400).json({ success: false, message: "OTP must be 6 digits" });
  }

  next();
};

const validateLogin = (req, res, next) => {
  const { email, password } = req.body;

  const missing = getMissingFields(req, ['email', 'password']);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} is/are required` });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Invalid email format" });
  }

  next();
};

const validateForgotPassword = (req, res, next) => {
  const { email } = req.body;

  const missing = getMissingFields(req, ['email']);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `Email is required` });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Invalid email format" });
  }

  next();
};

const validateResetPassword = (req, res, next) => {
  const { userId, otp, newPassword } = req.body;

  const missing = getMissingFields(req, ['userId', 'otp', 'newPassword']);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `${missing.join(', ')} is/are required` });
  }

  if (isNaN(Number(userId))) {
    return res.status(400).json({ success: false, message: "Invalid user ID format" });
  }

  if (!isValidOTP(otp)) {
    return res.status(400).json({ success: false, message: "OTP must be 6 digits" });
  }

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.isValid) {
    return res.status(400).json({ success: false, message: passwordCheck.message });
  }

  next();
};

const validateRefreshToken = (req, res, next) => {
  const { refreshToken } = req.body;

  const missing = getMissingFields(req, ['refreshToken']);
  if (missing.length > 0) {
    return res.status(400).json({ success: false, message: `Refresh token is required` });
  }

  if (typeof refreshToken !== 'string' || refreshToken.split('.').length !== 3) {
    return res.status(400).json({ success: false, message: "Invalid refresh token format" });
  }

  next();
};

const validateChangePassword = (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!sanitizeString(currentPassword) || !sanitizeString(newPassword)) {
    return res.status(400).json({ success: false, message: "Current password and new password are required" });
  }

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.isValid) {
    return res.status(400).json({ success: false, message: passwordCheck.message });
  }

  next();
};

// ==================== EXPORTS ====================
module.exports = {
  validateSignup,
  validateVerifySignup,
  validateLogin,
  validateForgotPassword,
  validateResetPassword,
  validateRefreshToken,
  validateChangePassword
};