const { validateUpdateUserRole } = require('../validators/adminValidator');

describe('Admin RBAC Prototype Pollution Prevention', () => {
    
    test('should prevent prototype pollution payloads via Joi validation', () => {
        // Mock request and response
        const req = {
            body: JSON.parse('{"role": "admin", "__proto__": {"isAdmin": true}}')
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        // The parsed JSON will have an __proto__ if parser allows it.
        // Wait, JSON.parse doesn't actually set __proto__ on the object prototype in a way that pollutes Object.prototype, 
        // but let's simulate a polluted body object that a malicious actor might send.
        const maliciousBody = Object.create(null);
        maliciousBody.role = "admin";
        maliciousBody.__proto__ = { isAdmin: true };
        req.body = maliciousBody;

        validateUpdateUserRole(req, res, next);

        // Joi should successfully validate 'role' and strip everything else,
        // replacing req.body with a clean object that doesn't have the __proto__ trap.
        expect(next).toHaveBeenCalled();
        expect(req.body.isAdmin).toBeUndefined();
        expect(req.body.role).toBe('admin');
        
        // Ensure that Object.prototype is not polluted (just in case)
        expect({}.isAdmin).toBeUndefined();
    });

    test('RBAC configuration objects should have null prototypes', () => {
        const policy = require('../config/policy');
        
        // Assert that the prototypes are null
        expect(Object.getPrototypeOf(policy.ROLES)).toBeNull();
        expect(Object.getPrototypeOf(policy.PERMISSIONS)).toBeNull();
        expect(Object.getPrototypeOf(policy.ROLE_PERMISSIONS)).toBeNull();

        // Attempting prototype pollution on ROLES should fail
        // since it's both frozen and has no prototype.
        expect(() => {
            policy.ROLES.__proto__ = { ADMIN: 'hacker' };
        }).toThrow();
        
        expect(policy.ROLES.ADMIN).toBe('admin');
    });
});
