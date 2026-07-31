// backend/core/diContainer.js
const crypto = require('crypto');

// ============================================
// DI CONFIGURATION
// ============================================

const LIFETIME = {
    SINGLETON: 'singleton',
    SCOPED: 'scoped',
    TRANSIENT: 'transient'
};

// ============================================
// DEPENDENCY INJECTION CONTAINER
// ============================================

class DIContainer {
    constructor() {
        this.registrations = new Map();
        this.singletons = new Map();
        this.scopedInstances = new Map();
        this.currentScope = null;
        this.factories = new Map();
        this.aliases = new Map();
        this.initialized = false;
    }

    /**
     * Initialize container
     */
    initialize() {
        if (this.initialized) return;
        this.initialized = true;
        console.log('✅ DI Container initialized');
        return this;
    }

    /**
     * Register a service
     */
    register(token, implementation, options = {}) {
        const registration = {
            token,
            implementation,
            lifetime: options.lifetime || LIFETIME.SINGLETON,
            dependencies: options.dependencies || [],
            factory: options.factory || null,
            args: options.args || [],
            instance: null,
            resolving: false
        };

        this.registrations.set(token, registration);
        
        // Register aliases
        if (options.aliases) {
            for (const alias of options.aliases) {
                this.aliases.set(alias, token);
            }
        }

        console.log(`📦 Service registered: ${token}`);
        return this;
    }

    /**
     * Register a factory
     */
    registerFactory(token, factory, options = {}) {
        return this.register(token, null, {
            ...options,
            factory,
            lifetime: options.lifetime || LIFETIME.TRANSIENT
        });
    }

    /**
     * Register a singleton
     */
    registerSingleton(token, implementation, dependencies = []) {
        return this.register(token, implementation, {
            lifetime: LIFETIME.SINGLETON,
            dependencies
        });
    }

    /**
     * Register a scoped service
     */
    registerScoped(token, implementation, dependencies = []) {
        return this.register(token, implementation, {
            lifetime: LIFETIME.SCOPED,
            dependencies
        });
    }

    /**
     * Register a transient service
     */
    registerTransient(token, implementation, dependencies = []) {
        return this.register(token, implementation, {
            lifetime: LIFETIME.TRANSIENT,
            dependencies
        });
    }

    /**
     * Register an alias
     */
    registerAlias(alias, token) {
        this.aliases.set(alias, token);
        return this;
    }

    /**
     * Resolve a service
     */
    resolve(token) {
        // Handle aliases
        const resolvedToken = this.aliases.get(token) || token;

        const registration = this.registrations.get(resolvedToken);
        if (!registration) {
            throw new Error(`Service not registered: ${resolvedToken}`);
        }

        // Prevent circular dependencies
        if (registration.resolving) {
            throw new Error(`Circular dependency detected: ${resolvedToken}`);
        }

        // Check lifetime
        if (registration.lifetime === LIFETIME.SINGLETON) {
            return this.resolveSingleton(resolvedToken);
        }

        if (registration.lifetime === LIFETIME.SCOPED) {
            return this.resolveScoped(resolvedToken);
        }

        return this.resolveTransient(resolvedToken);
    }

    /**
     * Resolve a singleton
     */
    resolveSingleton(token) {
        if (this.singletons.has(token)) {
            return this.singletons.get(token);
        }

        const instance = this.createInstance(token);
        this.singletons.set(token, instance);
        return instance;
    }

    /**
     * Resolve a scoped service
     */
    resolveScoped(token) {
        const scopeKey = this.currentScope || 'default';

        if (!this.scopedInstances.has(scopeKey)) {
            this.scopedInstances.set(scopeKey, new Map());
        }

        const scope = this.scopedInstances.get(scopeKey);
        if (scope.has(token)) {
            return scope.get(token);
        }

        const instance = this.createInstance(token);
        scope.set(token, instance);
        return instance;
    }

    /**
     * Resolve a transient service
     */
    resolveTransient(token) {
        return this.createInstance(token);
    }

    /**
     * Create an instance of a service
     */
    createInstance(token) {
        const registration = this.registrations.get(token);
        if (!registration) {
            throw new Error(`Service not registered: ${token}`);
        }

        // Prevent circular dependencies
        if (registration.resolving) {
            throw new Error(`Circular dependency detected: ${token}`);
        }

        registration.resolving = true;

        try {
            // Use factory if provided
            if (registration.factory) {
                const deps = this.resolveDependencies(registration.dependencies);
                const instance = registration.factory(...deps);
                registration.resolving = false;
                return instance;
            }

            // Use constructor injection
            if (registration.implementation) {
                const deps = this.resolveDependencies(registration.dependencies);
                const instance = new registration.implementation(...deps);
                registration.resolving = false;
                return instance;
            }

            throw new Error(`No implementation or factory for: ${token}`);
        } catch (error) {
            registration.resolving = false;
            throw error;
        }
    }

    /**
     * Resolve dependencies for a service
     */
    resolveDependencies(dependencies) {
        return dependencies.map(dep => {
            if (typeof dep === 'string') {
                return this.resolve(dep);
            }
            if (typeof dep === 'function') {
                return dep(this);
            }
            return dep;
        });
    }

    /**
     * Create a new scope
     */
    createScope(name) {
        const scopeId = name || `scope_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        this.scopedInstances.set(scopeId, new Map());
        return scopeId;
    }

    /**
     * Enter a scope
     */
    enterScope(name) {
        this.currentScope = name || `scope_${Date.now()}`;
        if (!this.scopedInstances.has(this.currentScope)) {
            this.scopedInstances.set(this.currentScope, new Map());
        }
        return this.currentScope;
    }

    /**
     * Exit current scope
     */
    exitScope() {
        if (this.currentScope) {
            this.scopedInstances.delete(this.currentScope);
            this.currentScope = null;
        }
    }

    /**
     * Clear all instances
     */
    clear() {
        this.singletons.clear();
        this.scopedInstances.clear();
        this.currentScope = null;
        console.log('🧹 DI Container cleared');
    }

    /**
     * Reset container
     */
    reset() {
        this.registrations.clear();
        this.singletons.clear();
        this.scopedInstances.clear();
        this.aliases.clear();
        this.factories.clear();
        this.currentScope = null;
        this.initialized = false;
        console.log('🔄 DI Container reset');
    }

    /**
     * Check if service is registered
     */
    has(token) {
        return this.registrations.has(token) || this.aliases.has(token);
    }

    /**
     * Get registration info
     */
    getRegistration(token) {
        const resolvedToken = this.aliases.get(token) || token;
        return this.registrations.get(resolvedToken) || null;
    }

    /**
     * Get all registered tokens
     */
    getRegisteredTokens() {
        return Array.from(this.registrations.keys());
    }

    /**
     * Get singleton instances
     */
    getSingletons() {
        return Array.from(this.singletons.entries());
    }

    /**
     * Get scoped instances
     */
    getScopedInstances(scope = null) {
        const scopeKey = scope || this.currentScope || 'default';
        return this.scopedInstances.get(scopeKey) || new Map();
    }

    /**
     * Get container stats
     */
    getStats() {
        return {
            registrations: this.registrations.size,
            aliases: this.aliases.size,
            singletons: this.singletons.size,
            scopes: this.scopedInstances.size,
            currentScope: this.currentScope,
            initialized: this.initialized
        };
    }

    /**
     * Create a child container
     */
    createChild() {
        const child = new DIContainer();
        child.registrations = new Map(this.registrations);
        child.aliases = new Map(this.aliases);
        child.factories = new Map(this.factories);
        return child;
    }

    /**
     * Call a function with dependency injection
     */
    call(fn, context = {}) {
        const fnStr = fn.toString();
        const args = [];
        
        // Extract parameter names
        const match = fnStr.match(/^function\s*\(([^)]*)\)/);
        if (match) {
            const paramNames = match[1].split(',').map(p => p.trim());
            for (const param of paramNames) {
                if (param && context[param]) {
                    args.push(context[param]);
                } else if (param && this.has(param)) {
                    args.push(this.resolve(param));
                }
            }
        }

        return fn(...args);
    }
}

// ============================================
// DECORATORS
// ============================================

/**
 * Injectable decorator
 */
function Injectable(token, options = {}) {
    return function(target) {
        const container = require('../core/diContainer').container;
        const deps = Reflect.getMetadata('design:paramtypes', target) || [];
        container.register(token || target.name, target, {
            ...options,
            dependencies: deps.map(dep => dep.name)
        });
        return target;
    };
}

/**
 * Inject decorator
 */
function Inject(token) {
    return function(target, propertyKey, parameterIndex) {
        const container = require('../core/diContainer').container;
        // Store injection metadata
        if (!Reflect.hasMetadata('injections', target)) {
            Reflect.defineMetadata('injections', [], target);
        }
        const injections = Reflect.getMetadata('injections', target);
        injections.push({ parameterIndex, token });
        Reflect.defineMetadata('injections', injections, target);
    };
}

// ============================================
// EXPORT
// ============================================

const container = new DIContainer();

module.exports = {
    DIContainer,
    LIFETIME,
    container,
    Injectable,
    Inject
};