# Barzo PWA

A modern social PWA with push notifications and location services.

## Features

- Progressive Web App (PWA)
- Push notifications via Cloudflare Workers
- Location-based services
- Cross-platform support (iOS/Android)
- Offline capabilities

## Tech Stack

- Frontend: Vanilla JS + TailwindCSS
- Backend: Express.js
- Push Notifications: Cloudflare Workers + Web Push
- Storage: Cloudflare KV

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start Cloudflare Worker
npm run worker:dev
```

## Deployment

### Worker Deployment
```bash
npm run worker:deploy
```

### Environment Variables

Create a `.env` file:
```
PORT=3000
NODE_ENV=development
WORKER_URL=http://localhost:8787
```

### Cloudflare Worker Configuration

Update `wrangler.toml` with your KV namespace IDs:
```toml
[[kv_namespaces]]
binding = "SUBSCRIPTIONS"
preview_id = "your_preview_id"
id = "your_production_id"
```

## Project Structure

```
├── public/              # Static files
│   ├── index.html      # Main PWA entry
│   ├── manifest.json   # PWA manifest
│   ├── service-worker.js          # Service Worker
│   └── icons/         # PWA icons
├── worker/            # Cloudflare Worker
│   └── index.js      # Worker entry point
├── server.js         # Express server
└── wrangler.toml     # Worker configuration
```

## License

MIT
