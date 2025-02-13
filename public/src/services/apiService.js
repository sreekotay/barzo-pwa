// Create a new file for API configuration
export function getApiUrl() {
    const isLocalhost = window.location.hostname === 'localhost' || 
                       window.location.hostname === '127.0.0.1';
    return isLocalhost && 1 ? 
        'http://localhost:8787' : 
        'https://nearby-places.sree-35c.workers.dev';
        //'https://enhanced-places.sree-35c.workers.dev';
} 