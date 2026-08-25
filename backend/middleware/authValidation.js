const { sanitizeString } = require("../utils/helpers");
const { isValidEmail, validatePassword } = require("../utils/validators");
// The OTP helpers live in their own module. This file used to reach for
// `isValidOTP` on ../utils/validators, which has never exported it -- the name
// bound `undefined` and both call sites below threw a TypeError on every
// request, so verify-signup and reset-password answered 500 instead of the 400
// they were written to return.
//
// `isOTPFormatValid` is the one that belongs here rather than `isValidOTP`:
// it takes the code alone and returns a boolean, which is what a validation
// middleware wants. `isValidOTP(userId, otp)` is a different job -- it consumes
// the caller's rate-limit budget and returns a result object, so calling it
// here would both spend an attempt before the controller had verified anything
// and, because an object is always truthy, never reject.
const { isOTPFormatValid } = require("../utils/otpvalidators");
const { isRefreshTokenWellFormed } = require("../utils/tokens");

// Appwrite issues the id that reset-password quotes back, so it is an opaque
// account id and not a row id: at most 36 characters of [A-Za-z0-9._-] that
// cannot begin with a special character. It is neither numeric nor a UUID.
//
// The check this replaces was `isNaN(Number(userId))`. `users.id` is CHAR(36)
// and Appwrite's ids are alphanumeric, so `Number()` was NaN for every real id
// and the branch rejected all of them with "Invalid user ID format".
//
// Shape only. Whether the id names a real account is Appwrite's answer to give,
// and `resetPassword` asks it -- guessing here would turn this into an oracle
// for which accounts exist, which is the thing forgotPassword goes out of its
// way not to be.
const APPWRITE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,35}$/;

const isValidAccountId = (value) => APPWRITE_ID_PATTERN.test(sanitizeString(value));

// `validators.isValidEmail` answers with `{ isValid, message }`, not a boolean.
// Every check in this file was written as `if (!isValidEmail(email))`, and an
// object is always truthy, so `!` was always false: the address format was
// never actually checked in signup, verify-signup, login or forgot-password.
//
// Read the field the helper documents. `validatePassword` in the same module
// has the same shape and is already consumed correctly a few lines down, which
// is what the address checks should have looked like.
const hasValidEmail = (email) => isValidEmail(email).isValid === true;

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

  if (!hasValidEmail(email)) {
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

  if (!hasValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Invalid email format" });
  }

  if (!isOTPFormatValid(otp)) {
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

  if (!hasValidEmail(email)) {
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

  if (!hasValidEmail(email)) {
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

  if (!isValidAccountId(userId)) {
    return res.status(400).json({ success: false, message: "Invalid user ID format" });
  }

  if (!isOTPFormatValid(otp)) {
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

  // The shape is asserted by the module that issues these tokens. Spelling the
  // expected format out here is what let this check drift into rejecting every
  // token the service produced.
  if (!isRefreshTokenWellFormed(sanitizeString(refreshToken))) {
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