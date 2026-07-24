// src/utils/userStatusValidator.js

// Allowed User Statuses (Ek hi jagah define hai)
const USER_STATUSES = ['active', 'blocked', 'inactive'];

// Reusable Validation Function
const validateUserStatus = (status) => {
  if (!USER_STATUSES.includes(status)) {
    throw new Error(`Invalid user status: ${status}. Allowed values are: ${USER_STATUSES.join(', ')}`);
  }
  return true;
};

module.exports = { USER_STATUSES, validateUserStatus };