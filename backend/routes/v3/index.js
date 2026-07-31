// backend/routes/v3/index.js
//
// See routes/v1/index.js for why these three version modules exist. They were
// required by routes/apiRoutes.js but never created, so that file could not be
// loaded at all.
//
// v3 is the current version, per the `currentVersion` field apiRoutes.js
// reports on GET /.

const express = require('express');
const router = express.Router();

const sharedRoutes = require('../index');

router.use((req, res, next) => {
    res.setHeader('X-API-Version', 'v3');
    next();
});

router.use('/', sharedRoutes);

module.exports = router;
