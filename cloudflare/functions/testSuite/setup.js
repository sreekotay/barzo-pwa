// Mock fetch globally
global.fetch = jest.fn();

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