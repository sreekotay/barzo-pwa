// This is the Pusher Beams service worker
importScripts('https://js.pusher.com/beams/service-worker.js');

// Basic service worker
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  const options = {
    body: event.data.text(),
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [100, 50, 100],
  };

  event.waitUntil(
    self.registration.showNotification('Barzo PWA', options)
  );
}); 