import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'tovarix-offline-shell',
    generateBundle(_options, bundle) {
      const assets = Object.keys(bundle);
      const version = assets.filter(name => name.startsWith('assets/')).sort().join('-');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `
          const namespace = 'tovarix-shell-';
          const cache = namespace + ${JSON.stringify(version)};
          const assets = ${JSON.stringify(['/', '/tovarix-config.json', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...assets.map(name => '/' + name)])};
          self.addEventListener('install', event => event.waitUntil(caches.open(cache).then(store => store.addAll(assets))));
          self.addEventListener('activate', event => event.waitUntil(
            caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(namespace) && key !== cache).map(key => caches.delete(key))))
          ));
          self.addEventListener('fetch', event => {
            const url = new URL(event.request.url);
            if (url.origin !== location.origin || event.request.method !== 'GET') return;
            if (url.pathname === '/tovarix-config.json') {
              event.respondWith(fetch(event.request).then(async response => {
                if (response.ok) await (await caches.open(cache)).put(event.request, response.clone());
                return response;
              }).catch(() => caches.open(cache).then(store => store.match(event.request))));
            } else if (event.request.mode === 'navigate') {
              event.respondWith(fetch(event.request).catch(() => caches.open(cache).then(store => store.match('/'))));
            } else if (assets.includes(url.pathname)) {
              event.respondWith(caches.open(cache).then(store => store.match(event.request)).then(res => res || fetch(event.request)));
            }
          });
        `,
      });
    },
  }],
});
