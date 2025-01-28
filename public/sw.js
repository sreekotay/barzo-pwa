// Push event - handle incoming push notifications
self.addEventListener('push', event => {
  const options = {
    body: event.data.text(),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'View message',
      },
      {
        action: 'close',
        title: 'Close',
      },
    ]
  };

  event.waitUntil(
    self.registration.showNotification('Barzo', options)
  );
});

// Notification click event
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/chat.html')
    );
  }
}); 