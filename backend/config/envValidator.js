const validator = require('validator');

const ENV_CONFIG = {
    required: [
        { name: 'DB_HOST', type: 'string', message: 'Database host is required' },
        { name: 'DB_PORT', type: 'number', message: 'Database port is required' },
        { name: 'DB_USER', type: 'string', message: 'Database user is required' },
        { name: 'DB_PASSWORD', type: 'string', message: 'Database password is required' },
        { name: 'DB_NAME', type: 'string', message: 'Database name is required' },
        { name: 'JWT_SECRET', type: 'string', minLength: 32, message: 'JWT secret must be at least 32 characters' },
        { name: 'PORT', type: 'number', message: 'Server port is required' },
        { name: 'FRONTEND_URL', type: 'url', message: 'Frontend URL is required' },
        { name: 'NODE_ENV', type: 'string', message: 'Node environment is required' }
    ],
    optional: [
        { name: 'DB_SSL', type: 'boolean', default: false },
        { name: 'DB_CONNECTION_LIMIT', type: 'number', default: 10 },
        { name: 'DB_CONNECT_TIMEOUT', type: 'number', default: 10000 },
        { name: 'DB_ACQUIRE_TIMEOUT', type: 'number', default: 30000 },
        { name: 'DB_QUERY_TIMEOUT', type: 'number', default: 30000 },
        { name: 'DB_MAX_RETRIES', type: 'number', default: 10 },
        { name: 'DB_INITIAL_DELAY', type: 'number', default: 1000 },
        { name: 'DB_MAX_DELAY', type: 'number', default: 30000 },
        { name: 'LOG_LEVEL', type: 'string', default: 'info' },
        { name: 'REDIS_HOST', type: 'string', default: '127.0.0.1' },
        { name: 'REDIS_PORT', type: 'number', default: 6379 },
        { name: 'REDIS_PASSWORD', type: 'string', default: '' },
        { name: 'ANTHROPIC_API_KEY', type: 'string', default: '' },
        { name: 'AI_MODEL', type: 'string', default: 'claude-3-sonnet-20241022' },
        { name: 'AI_MAX_TOKENS', type: 'number', default: 1024 },
        { name: 'AI_TEMPERATURE', type: 'number', default: 0.7 },
        { name: 'AI_TIMEOUT', type: 'number', default: 30000 },
        { name: 'AI_MAX_RETRIES', type: 'number', default: 3 },
        { name: 'ENABLE_CACHING', type: 'boolean', default: true },
        { name: 'SERVICE_NAME', type: 'string', default: 'api-service' },
        { name: 'CORS_ORIGINS', type: 'string', default: '*' },
        { name: 'RATE_LIMIT_WINDOW', type: 'number', default: 60000 },
        { name: 'RATE_LIMIT_MAX', type: 'number', default: 100 },
        { name: 'SESSION_SECRET', type: 'string', default: '' }
    ]
};

function validateType(value, type) {
    switch (type) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return !isNaN(Number(value)) && Number(value) >= 0;
        case 'boolean':
            return value === 'true' || value === 'false' || value === true || value === false;
        case 'url':
            return validator.isURL(value);
        case 'email':
            return validator.isEmail(value);
        case 'jwt':
            return value && value.length >= 32;
        default:
            return true;
    }
}

function parseValue(value, type) {
    switch (type) {
        case 'number':
            return Number(value);
        case 'boolean':
            return value === 'true' || value === true;
        case 'string':
        case 'url':
        case 'email':
        case 'jwt':
            return value;
        default:
            return value;
    }
}

function validateEnv() {
    const errors = [];
    const warnings = [];
    const suggestions = [];
    const appliedDefaults = {};

    console.log('\n🔍 Validating Environment Variables...\n');

    // Validate required variables
    for (const config of ENV_CONFIG.required) {
        const value = process.env[config.name];
        
        if (!value || value.trim() === '') {
            errors.push({
                name: config.name,
                message: config.message || `${config.name} is required`
            });
            continue;
        }

        if (config.minLength && value.length < config.minLength) {
            errors.push({
                name: config.name,
                message: config.message || `${config.name} must be at least ${config.minLength} characters`
            });
        }

        if (config.type && !validateType(value, config.type)) {
            errors.push({
                name: config.name,
                message: `${config.name} must be a valid ${config.type}`
            });
        }

        // Additional validations
        if (config.name === 'NODE_ENV' && !['development', 'production', 'test'].includes(value)) {
            errors.push({
                name: config.name,
                message: 'NODE_ENV must be one of: development, production, test'
            });
        }

        if (config.name === 'DB_PORT') {
            const port = Number(value);
            if (port < 1 || port > 65535) {
                errors.push({
                    name: config.name,
                    message: 'DB_PORT must be between 1 and 65535'
                });
            }
        }

        if (config.name === 'PORT') {
            const port = Number(value);
            if (port < 1 || port > 65535) {
                errors.push({
                    name: config.name,
                    message: 'PORT must be between 1 and 65535'
                });
            }
        }
    }

    // Validate optional variables
    for (const config of ENV_CONFIG.optional) {
        const value = process.env[config.name];
        
        if (value === undefined || value === null || value === '') {
            if (config.default !== undefined) {
                process.env[config.name] = String(config.default);
                appliedDefaults[config.name] = config.default;
                warnings.push({
                    name: config.name,
                    message: `Using default value: ${config.default}`
                });
            }
            continue;
        }

        if (config.type && !validateType(value, config.type)) {
            warnings.push({
                name: config.name,
                message: `Invalid type for ${config.name}. Expected ${config.type}, using as-is`
            });
        }

        // Parse and store typed value
        if (config.type) {
            process.env[config.name] = String(parseValue(value, config.type));
        }
    }

    // Check for unknown variables
    const knownVars = new Set([
        ...ENV_CONFIG.required.map(c => c.name),
        ...ENV_CONFIG.optional.map(c => c.name)
    ]);
    
    for (const key of Object.keys(process.env)) {
        if (!knownVars.has(key) && !key.startsWith('npm_') && !key.startsWith('_')) {
            warnings.push({
                name: key,
                message: `Unknown environment variable found: ${key}`
            });
        }
    }

    // Generate suggestions for missing variables
    if (errors.length > 0) {
        const missingNames = errors.map(e => e.name);
        suggestions.push('📝 Suggested .env file content:');
        suggestions.push('');
        for (const config of ENV_CONFIG.required) {
            const hasValue = process.env[config.name] && process.env[config.name].trim() !== '';
            if (!hasValue) {
                suggestions.push(`${config.name}=${getExampleValue(config)}`);
            }
        }
        suggestions.push('');
    }

    // Display results
    if (errors.length === 0) {
        console.log('✅ All required environment variables are present and valid.');
    }

    if (Object.keys(appliedDefaults).length > 0) {
        console.log(`\n✅ Applied ${Object.keys(appliedDefaults).length} default values:`);
        for (const [name, value] of Object.entries(appliedDefaults)) {
            console.log(`   - ${name}: ${value}`);
        }
    }

    if (warnings.length > 0) {
        console.log(`\n⚠️  ${warnings.length} warning(s):`);
        for (const warning of warnings) {
            console.log(`   - ${warning.message}`);
        }
    }

    if (errors.length > 0) {
        console.error(`\n❌ ${errors.length} error(s):`);
        for (const error of errors) {
            console.error(`   - ${error.message}`);
        }
        
        if (suggestions.length > 0) {
            console.error('\n' + suggestions.join('\n'));
        }

        console.error('\n💡 Tip: Create a .env file in the root directory with the required variables.');
        console.error('   Check .env.example for reference.\n');
        
        process.exit(1);
    }

    console.log(`\n✅ Environment validation passed! (${ENV_CONFIG.required.length} required, ${ENV_CONFIG.optional.length} optional)`);
    console.log(`   Node Environment: ${process.env.NODE_ENV}`);
    console.log(`   Service: ${process.env.SERVICE_NAME || 'api-service'}\n`);
}

function getExampleValue(config) {
    if (config.example) return config.example;
    switch (config.type) {
        case 'string': return `your_${config.name.toLowerCase()}`;
        case 'number': return '123';
        case 'boolean': return 'true';
        case 'url': return 'http://localhost:3000';
        case 'email': return 'user@example.com';
        case 'jwt': return 'your_super_secret_jwt_key_at_least_32_chars';
        default: return '';
    }
}

function generateEnvExample() {
    let content = '# Environment Variables Configuration\n\n';
    
    content += '# ============================================\n';
    content += '# REQUIRED VARIABLES\n';
    content += '# ============================================\n\n';
    
    for (const config of ENV_CONFIG.required) {
        const example = getExampleValue(config);
        content += `# ${config.message || ''}\n`;
        content += `${config.name}=${example}\n\n`;
    }
    
    content += '# ============================================\n';
    content += '# OPTIONAL VARIABLES (with defaults)\n';
    content += '# ============================================\n\n';
    
    for (const config of ENV_CONFIG.optional) {
        const example = config.default !== undefined ? config.default : getExampleValue(config);
        content += `# ${config.name} (default: ${example})\n`;
        content += `# ${config.name}=${example}\n\n`;
    }
    
    return content;
}

function getValidationSummary() {
    const required = ENV_CONFIG.required.map(c => ({
        name: c.name,
        type: c.type,
        present: !!(process.env[c.name] && process.env[c.name].trim() !== ''),
        value: process.env[c.name] ? process.env[c.name].substring(0, 20) + (process.env[c.name].length > 20 ? '...' : '') : null
    }));
    
    const optional = ENV_CONFIG.optional.map(c => ({
        name: c.name,
        type: c.type,
        present: !!(process.env[c.name] && process.env[c.name].trim() !== ''),
        value: process.env[c.name] ? process.env[c.name].substring(0, 20) + (process.env[c.name].length > 20 ? '...' : '') : null,
        default: c.default
    }));
    
    return { required, optional };
}

module.exports = { 
    validateEnv, 
    generateEnvExample,
    getValidationSummary,
    ENV_CONFIG
};