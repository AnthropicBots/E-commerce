// backend/babel.config.js
//
// Used only by babel-jest, to transpile the handful of ESM-only packages in
// node_modules that the test runner cannot otherwise load. Application code is
// plain CommonJS and is unaffected -- nothing in this project is built with
// Babel at runtime.
//
// See `transformIgnorePatterns` in jest.config.js for which packages this
// applies to and why.
module.exports = {
    presets: [
        [
            '@babel/preset-env',
            {
                // Match the Node running the tests rather than downlevelling
                // to browsers; this only has to produce something Jest's
                // CommonJS runtime can require.
                targets: { node: 'current' }
            }
        ]
    ]
};
