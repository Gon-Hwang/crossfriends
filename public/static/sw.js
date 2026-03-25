// CROSSfriends Service Worker - Web Push (v3)
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('message', (event) => {
  const type = event?.data?.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  const title = data.title || '크프';
  const options = {
    body: data.body || '새 알림이 있습니다.',
    icon: data.icon || '/static/favicon.ico',
    badge: data.badge || '/static/favicon.ico',
    data: { url: data.url || '/' },
    tag: data.tag || 'crossfriends-notification',
    renotify: true
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
