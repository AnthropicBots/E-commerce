// backend/routes/v2/index.js
//
// See routes/v1/index.js for why these three version modules exist. They were
// required by routes/apiRoutes.js but never created, so that file could not be
// loaded at all.

const express = require('express');
const router = express.Router();

const sharedRoutes = require('../index');

router.use((req, res, next) => {
    res.setHeader('X-API-Version', 'v2');
    next();
});

router.use('/', sharedRoutes);

module.exports = router;
