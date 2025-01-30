const express = require('express');
const path = require('path');
const helmet = require('helmet');
const WORKER_URL = process.env.WORKER_URL || 'http://localhost:8787';
const app = express();
const fs = require('fs');

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_VERCEL = process.env.VERCEL || false;

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// Middleware
app.use(express.json());

// Handle both service workers
app.get(['/service-worker.js'], (req, res) => {
  res.set({
    'Content-Type': 'application/javascript',
    'Service-Worker-Allowed': '/',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type'
  });

  // Fix: Use the actual path instead of a boolean
  const filePath = path.join(__dirname, 'public', 'service-worker.js');
  res.sendFile(filePath);
});

// Move this BEFORE the helmet middleware
app.use(express.static('public', {
  maxAge: NODE_ENV === 'production' ? '1d' : 0,
  setHeaders: (res, path) => {
    if (path.endsWith('service-worker.js')) {
      res.set('Service-Worker-Allowed', '/');
    }
  }
}));

// Security headers middleware using helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'", 
        "'unsafe-inline'",
        "'unsafe-eval'",
        "'unsafe-hashes'",
        "https://cdn.tailwindcss.com",
        "https://js.pusher.com",
        "https://js.pusher.com/beams/",
        "https:"
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", 
        "https://cdn.tailwindcss.com"
      ],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: [
        "'self'",
        "https://cdn.tailwindcss.com",
        "https://js.pusher.com",
        "https://js.pusher.com/beams/",
        IS_VERCEL ? "https://*.vercel.app" : "ws://localhost:*",
        IS_VERCEL ? "wss://*.vercel.app" : "ws://0.0.0.0:*",
        WORKER_URL,
        'http://localhost:8787'
      ],
      fontSrc: ["'self'", "data:", "https://cdn.tailwindcss.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      workerSrc: [
        "'self'", 
        "blob:", 
        "'unsafe-inline'", 
        "'unsafe-eval'",
        "https:",
        "http://localhost:3000"
      ],
      manifestSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: { policy: "credentialless" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: "deny" },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  xssFilter: true
}));

// Additional custom security headers
app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 
    'geolocation=(self), ' +
    'camera=(), ' +
    'microphone=(), ' +
    'payment=(), ' +
    'usb=(), ' +
    'magnetometer=(), ' +
    'accelerometer=(), ' +
    'gyroscope=()'
  );

  if (NODE_ENV === 'production') {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
  }

  next();
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: NODE_ENV === 'development' ? err.message : 'Internal Server Error'
  });
});

// API Routes - proxy to worker
app.get('/api/vapidPublicKey', async (req, res, next) => {
  try {
    console.log('Fetching VAPID key from worker:', `${WORKER_URL}/api/vapidPublicKey`);
    const response = await fetch(`${WORKER_URL}/api/vapidPublicKey`, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get VAPID key');
    }
    const result = await response.json();
    console.log('VAPID key response:', result);
    res.json(result);
  } catch (error) {
    console.error('VAPID key error:', error);
    next(error);
  }
});

app.post('/api/subscribe', async (req, res, next) => {
  try {
    const response = await fetch(`${WORKER_URL}/api/subscribe`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        // Forward auth header if present
        ...(req.headers.authorization && { 
          'Authorization': req.headers.authorization 
        })
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/notify', async (req, res, next) => {
  try {
    const response = await fetch(`${WORKER_URL}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: req.body.message })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Serve index.html for all other routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Export the Express API for Vercel
module.exports = app;

// Start server only in development
if (NODE_ENV === 'development') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nServer running in ${NODE_ENV} mode`);
    console.log(`Local:            http://localhost:${PORT}`);
    
    if (require.main === module) {
      const os = require('os');
      const interfaces = os.networkInterfaces();
      Object.keys(interfaces).forEach((iface) => {
        interfaces[iface].forEach((details) => {
          if (details.family === 'IPv4' && !details.internal) {
            console.log(`Local Network:     http://${details.address}:${PORT}`);
          }
        });
      });
    }
  });
}

// Error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (!IS_VERCEL) process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  if (!IS_VERCEL) process.exit(1);
}); 