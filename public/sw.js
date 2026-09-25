self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.clients.matchAll({ type: 'window' }).then(clients => {
    for (const client of clients) client.navigate(client.url);
  });
  self.registration.unregister();
});
