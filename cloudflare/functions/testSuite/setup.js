// Mock fetch globally
global.fetch = jest.fn();

// Load .dev.vars environment variables
const fs = require('fs');
const path = require('path');

function loadDevVars() {
    try {
        const devVarsPath = path.join(__dirname, '../../.dev.vars');
        const content = fs.readFileSync(devVarsPath, 'utf8');
        const vars = {};
        
        content.split('\n').forEach(line => {
            const [key, value] = line.split('=');
            if (key && value) {
                vars[key.trim()] = value.trim();
            }
        });
        
        return vars;
    } catch (error) {
        console.warn('Could not load .dev.vars file:', error.message);
        return {};
    }
}

// Set up environment variables from .dev.vars
const devVars = loadDevVars();
Object.assign(process.env, devVars);

// Mock KV namespace
global.PLACES_KV = {
    get: jest.fn(),
    put: jest.fn()
};

// Mock Response if not available in test environment
if (typeof Response === 'undefined') {
    global.Response = class Response {
        constructor(body, init) {
            this.body = body;
            this.init = init;
            this.status = init?.status || 200;
            this.headers = new Map(Object.entries(init?.headers || {}));
        }
    };
} 