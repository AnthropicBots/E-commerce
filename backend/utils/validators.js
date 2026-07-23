/**
 * Validates if the given string is a properly formatted email address.
 * @param {string} email - Email to validate
 * @param {Object} options - Validation options
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isValid: boolean, message: string }
 */
const isValidEmail = (email, options = {}) => {
  const defaultMessage = 'Invalid email format';
  
  if (!email || typeof email !== 'string') {
    return { 
      isValid: false, 
      message: options.message || defaultMessage 
    };
  }
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValid = emailRegex.test(email.trim());
  
  return {
    isValid,
    message: isValid ? 'Valid email' : (options.message || defaultMessage)
  };
};

/**
 * Validates if the given password meets strong security requirements.
 * Requirements: Min 8 chars, uppercase, lowercase, number, and a special character.
 * @param {string} password - The password string to validate.
 * @param {Object} options - Validation options
 * @param {string} options.message - Custom error message
 * @param {number} options.minLength - Minimum length (default: 8)
 * @returns {Object} - { isValid: boolean, message: string }
 */
const validatePassword = (password, options = {}) => {
  const minLength = options.minLength || 8;
  const defaultMessages = {
    required: 'Password is required',
    minLength: `Password must be at least ${minLength} characters long`,
    strength: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@$!%*?&)'
  };

  if (!password || typeof password !== 'string') {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.required 
    };
  }
  
  if (password.length < minLength) {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.minLength 
    };
  }

  const strongPasswordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
  const isValid = strongPasswordRegex.test(password);
  
  return {
    isValid,
    message: isValid ? 'Password is strong' : (options.message || defaultMessages.strength)
  };
};

// ============================================
// NEW VALIDATION FUNCTIONS
// ============================================

/**
 * Validates if the username meets requirements.
 * @param {string} username - Username to validate
 * @param {Object} options - Validation options
 * @param {number} options.minLength - Minimum length (default: 3)
 * @param {number} options.maxLength - Maximum length (default: 30)
 * @param {boolean} options.allowUnderscore - Allow underscore (default: true)
 * @param {boolean} options.allowDot - Allow dot (default: false)
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isValid: boolean, message: string }
 */
const isValidUsername = (username, options = {}) => {
  const minLength = options.minLength || 3;
  const maxLength = options.maxLength || 30;
  const allowUnderscore = options.allowUnderscore !== false;
  const allowDot = options.allowDot || false;
  
  const defaultMessages = {
    required: 'Username is required',
    type: 'Username must be a string',
    minLength: `Username must be at least ${minLength} characters long`,
    maxLength: `Username must not exceed ${maxLength} characters`,
    format: `Username must contain only alphanumeric characters${allowUnderscore ? ', underscores' : ''}${allowDot ? ' and dots' : ''}`
  };

  if (!username) {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.required 
    };
  }
  
  if (typeof username !== 'string') {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.type 
    };
  }

  const trimmed = username.trim();
  
  if (trimmed.length < minLength) {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.minLength 
    };
  }
  
  if (trimmed.length > maxLength) {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.maxLength 
    };
  }

  // Build regex based on options
  let pattern = '^[A-Za-z0-9';
  if (allowUnderscore) pattern += '_';
  if (allowDot) pattern += '\\.';
  pattern += ']+$';
  
  const usernameRegex = new RegExp(pattern);
  const isValid = usernameRegex.test(trimmed);
  
  return {
    isValid,
    message: isValid ? 'Valid username' : (options.message || defaultMessages.format)
  };
};

/**
 * Validates if the phone number is valid.
 * @param {string} phone - Phone number to validate
 * @param {Object} options - Validation options
 * @param {string} options.countryCode - Country code (default: 'IN' for India)
 * @param {boolean} options.allowSpaces - Allow spaces (default: true)
 * @param {boolean} options.allowDashes - Allow dashes (default: true)
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isValid: boolean, message: string, normalized: string }
 */
const isValidPhone = (phone, options = {}) => {
  const countryCode = options.countryCode || 'IN';
  const allowSpaces = options.allowSpaces !== false;
  const allowDashes = options.allowDashes !== false;
  
  const defaultMessages = {
    required: 'Phone number is required',
    type: 'Phone number must be a string',
    format: `Invalid phone number format`
  };

  if (!phone) {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.required,
      normalized: null
    };
  }
  
  if (typeof phone !== 'string') {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.type,
      normalized: null
    };
  }

  // Remove spaces, dashes, and special characters for validation
  let normalized = phone.replace(/\s/g, '');
  if (allowDashes) {
    normalized = normalized.replace(/-/g, '');
  }
  normalized = normalized.replace(/[()+\s]/g, '');

  // Country-specific validation
  let isValid = false;
  let pattern = '';
  
  switch (countryCode.toUpperCase()) {
    case 'IN': // India
      pattern = /^[6-9]\d{9}$/; // 10 digits, starting with 6-9
      isValid = pattern.test(normalized);
      break;
    case 'US':
    case 'CA':
      pattern = /^[2-9]\d{2}[2-9]\d{6}$/; // 10 digits, US/Canada format
      isValid = pattern.test(normalized);
      break;
    case 'UK':
      pattern = /^7\d{9}$/; // 10 digits, starting with 7
      isValid = pattern.test(normalized);
      break;
    case 'AU':
      pattern = /^4\d{8}$/; // 9 digits, starting with 4
      isValid = pattern.test(normalized);
      break;
    default:
      // Generic validation: 7-15 digits
      pattern = /^\d{7,15}$/;
      isValid = pattern.test(normalized);
  }

  // Format the normalized number
  let formatted = normalized;
  if (countryCode.toUpperCase() === 'IN' && normalized.length === 10) {
    formatted = `+91 ${normalized.slice(0, 5)} ${normalized.slice(5)}`;
  }

  return {
    isValid,
    message: isValid ? 'Valid phone number' : (options.message || defaultMessages.format),
    normalized: normalized,
    formatted: formatted
  };
};

/**
 * Validates if the URL is valid.
 * @param {string} url - URL to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.requireProtocol - Require http/https (default: true)
 * @param {Array} options.allowedProtocols - Allowed protocols (default: ['http:', 'https:'])
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isValid: boolean, message: string }
 */
const isValidURL = (url, options = {}) => {
  const requireProtocol = options.requireProtocol !== false;
  const allowedProtocols = options.allowedProtocols || ['http:', 'https:'];
  
  const defaultMessages = {
    required: 'URL is required',
    type: 'URL must be a string',
    format: 'Invalid URL format',
    protocol: `URL must use protocols: ${allowedProtocols.join(', ')}`
  };

  if (!url) {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.required 
    };
  }
  
  if (typeof url !== 'string') {
    return { 
      isValid: false, 
      message: options.message || defaultMessages.type 
    };
  }

  const trimmed = url.trim();
  
  try {
    const urlObj = new URL(trimmed);
    
    // Check protocol if required
    if (requireProtocol) {
      if (!allowedProtocols.includes(urlObj.protocol)) {
        return {
          isValid: false,
          message: options.message || defaultMessages.protocol
        };
      }
    }
    
    // Check if hostname is valid
    if (!urlObj.hostname) {
      return {
        isValid: false,
        message: options.message || defaultMessages.format
      };
    }
    
    return {
      isValid: true,
      message: 'Valid URL'
    };
  } catch (error) {
    return {
      isValid: false,
      message: options.message || defaultMessages.format
    };
  }
};

/**
 * Checks if a string is empty (null, undefined, empty string, or whitespace only).
 * @param {string} value - Value to check
 * @param {Object} options - Validation options
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isEmpty: boolean, message: string }
 */
const isEmpty = (value, options = {}) => {
  const defaultMessage = 'Value is empty';
  
  if (value === null || value === undefined) {
    return {
      isEmpty: true,
      message: options.message || defaultMessage
    };
  }
  
  if (typeof value === 'string') {
    return {
      isEmpty: value.trim().length === 0,
      message: value.trim().length === 0 ? (options.message || defaultMessage) : 'Value is not empty'
    };
  }
  
  if (Array.isArray(value)) {
    return {
      isEmpty: value.length === 0,
      message: value.length === 0 ? (options.message || defaultMessage) : 'Value is not empty'
    };
  }
  
  if (typeof value === 'object') {
    return {
      isEmpty: Object.keys(value).length === 0,
      message: Object.keys(value).length === 0 ? (options.message || defaultMessage) : 'Value is not empty'
    };
  }
  
  return {
    isEmpty: false,
    message: 'Value is not empty'
  };
};

/**
 * Validates if a string length is within range.
 * @param {string} value - Value to validate
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum length (default: 0)
 * @param {number} options.max - Maximum length (default: Infinity)
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isValid: boolean, message: string, length: number }
 */
const isValidLength = (value, options = {}) => {
  const min = options.min || 0;
  const max = options.max || Infinity;
  
  const defaultMessages = {
    required: 'Value is required',
    type: 'Value must be a string',
    minLength: `Value must be at least ${min} characters long`,
    maxLength: `Value must not exceed ${max} characters`
  };

  if (!value && value !== 0) {
    return {
      isValid: false,
      message: options.message || defaultMessages.required,
      length: 0
    };
  }
  
  if (typeof value !== 'string') {
    return {
      isValid: false,
      message: options.message || defaultMessages.type,
      length: 0
    };
  }

  const length = value.length;
  let isValid = true;
  let message = 'Valid length';
  
  if (length < min) {
    isValid = false;
    message = options.message || defaultMessages.minLength;
  } else if (length > max) {
    isValid = false;
    message = options.message || defaultMessages.maxLength;
  }
  
  return {
    isValid,
    message: isValid ? message : (options.message || message),
    length
  };
};

/**
 * Sanitizes input to prevent XSS and injection attacks.
 * @param {string} input - Input to sanitize
 * @param {Object} options - Sanitization options
 * @param {boolean} options.trim - Trim whitespace (default: true)
 * @param {boolean} options.escapeHtml - Escape HTML characters (default: true)
 * @param {boolean} options.removeScripts - Remove script tags (default: true)
 * @param {boolean} options.normalizeSpaces - Normalize multiple spaces (default: false)
 * @param {string} options.encoding - Character encoding (default: 'utf-8')
 * @returns {string} - Sanitized string
 */
const sanitizeInput = (input, options = {}) => {
  if (input === null || input === undefined) {
    return '';
  }
  
  if (typeof input !== 'string') {
    return String(input);
  }

  let sanitized = input;
  
  // Trim whitespace
  if (options.trim !== false) {
    sanitized = sanitized.trim();
  }
  
  // Escape HTML characters
  if (options.escapeHtml !== false) {
    const htmlMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
      '=': '&#x3D;'
    };
    sanitized = sanitized.replace(/[&<>"'/=]/g, (char) => htmlMap[char] || char);
  }
  
  // Remove script tags
  if (options.removeScripts !== false) {
    sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  }
  
  // Normalize multiple spaces
  if (options.normalizeSpaces) {
    sanitized = sanitized.replace(/\s+/g, ' ');
  }
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  return sanitized;
};

/**
 * Validates if a string contains only allowed characters.
 * @param {string} value - Value to validate
 * @param {Object} options - Validation options
 * @param {string} options.pattern - Regex pattern (default: /^[a-zA-Z0-9\s]+$/)
 * @param {string} options.message - Custom error message
 * @returns {Object} - { isValid: boolean, message: string }
 */
const isValidPattern = (value, options = {}) => {
  const pattern = options.pattern || /^[a-zA-Z0-9\s]+$/;
  const defaultMessage = 'Value contains invalid characters';
  
  if (!value) {
    return {
      isValid: false,
      message: options.message || 'Value is required'
    };
  }
  
  if (typeof value !== 'string') {
    return {
      isValid: false,
      message: options.message || 'Value must be a string'
    };
  }
  
  const isValid = pattern.test(value);
  
  return {
    isValid,
    message: isValid ? 'Valid pattern' : (options.message || defaultMessage)
  };
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Existing
  isValidEmail,
  validatePassword,
  
  // New validators
  isValidUsername,
  isValidPhone,
  isValidURL,
  isEmpty,
  isValidLength,
  sanitizeInput,
  isValidPattern
};