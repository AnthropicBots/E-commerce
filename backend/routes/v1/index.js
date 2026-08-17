// backend/routes/v1/index.js
//
// `routes/apiRoutes.js` has always done `require('./v1')`, but no v1/ package
// existed, so the module threw MODULE_NOT_FOUND. The same was true of ./v2 and
// ./v3.
//
// All three versions currently serve the same endpoint surface -- the shared
// router in routes/index.js. They are separate modules so that when a version
// does need to diverge, the change is confined to that file rather than
// requiring the versioning scheme to be built from scratch first.
//
// `apiVersioning('v1')` in apiRoutes.js has already tagged the request by the
// time it reaches here.

const express = require('express');
const router = express.Router();

const sharedRoutes = require('../index');

// Advertise this version on every response so a client can tell which surface
// answered it without parsing the URL.
router.use((req, res, next) => {
    res.setHeader('X-API-Version', 'v1');
    next();
});

for (const [path, routeHandler] of Object.entries(sharedRoutes)) {
    router.use(path, routeHandler);
}

module.exports = router;
