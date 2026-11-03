// Offline shell for Skill Chat. API calls (GitHub, AI providers) always go to the network.
const CACHE = 'skill-chat-v1.2.0';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'lib/github.js', 'lib/frontmatter.js', 'lib/providers.js', 'lib/store.js', 'lib/md.js', 'lib/agent.js', 'lib/zip.js', 'lib/library.js', 'lib/video.js', 'preview.html',
  'vendor/marked.umd.js', 'vendor/purify.min.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  // network first, so updates arrive; cache as offline fallback
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
