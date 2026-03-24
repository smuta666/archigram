self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      title: 'ArchiGram',
      body: 'Новое сообщение',
      url: '/'
    };
  }

  const title = data.title || 'ArchiGram';
  const options = {
    body: data.body || 'Новое сообщение',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.chatId ? `chat-${data.chatId}` : 'archigram-message',
    renotify: true,
    data: {
      url: data.url || '/',
      chatId: data.chatId || null
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);

          if (clientUrl.origin === self.location.origin) {
            await client.navigate(targetUrl);
            return client.focus();
          }
        } catch {}
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});