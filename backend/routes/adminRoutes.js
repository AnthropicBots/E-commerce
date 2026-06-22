const express = require("express");
const router = express.Router();
const { getDashboardStats, getUsers, updateUserStatus, bulkUpdateUserStatus } = require("../controllers/admin.controller");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/rbacMiddleware");

// All admin routes are protected and require 'admin' role
router.use(authMiddleware);
router.use(authorizeRoles("admin"));

router.get("/dashboard", getDashboardStats);
router.get("/users", getUsers);
router.patch("/users/:id/status", updateUserStatus);
router.post("/users/bulk-status", bulkUpdateUserStatus);

module.exports = router;
