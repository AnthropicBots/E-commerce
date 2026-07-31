// backend/middleware/auth.js
const { authMiddleware } = require('./authMiddleware');
const { authorizeRoles } = require('./rbacMiddleware');

module.exports = {
    protect: authMiddleware,
    authorize: authorizeRoles
};
