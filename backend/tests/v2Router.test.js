const v2Router = require('../routes/v2/index');

describe('v2 Router Header Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        req = {};
        res = {
            headersSent: false,
            setHeader: jest.fn()
        };
        next = jest.fn();
    });

    test('should set X-API-Version header to v2 and call next()', () => {
        // Find the middleware function registered on the router
        const middlewareLayer = v2Router.stack.find(layer => layer.name === '<anonymous>');
        expect(middlewareLayer).toBeDefined();

        middlewareLayer.handle(req, res, next);

        expect(res.setHeader).toHaveBeenCalledWith('X-API-Version', 'v2');
        expect(next).toHaveBeenCalledWith();
    });

    test('should skip setting header and call next() if headers are already sent', () => {
        res.headersSent = true;

        const middlewareLayer = v2Router.stack.find(layer => layer.name === '<anonymous>');
        middlewareLayer.handle(req, res, next);

        expect(res.setHeader).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });

    test('should call next(err) if setHeader throws an error', () => {
        const error = new Error('Cannot set headers after they are sent');
        res.setHeader.mockImplementation(() => {
            throw error;
        });

        const middlewareLayer = v2Router.stack.find(layer => layer.name === '<anonymous>');
        middlewareLayer.handle(req, res, next);

        expect(next).toHaveBeenCalledWith(error);
    });
});
