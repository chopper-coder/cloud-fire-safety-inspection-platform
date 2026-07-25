'use strict';
const CACHE_NAME = 'gpai-v514-20260726';
const APP_ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest", "./data/questions.js", "./data/scheme.js", "./data/verified_legal_data.js", "./data/legal_basis.js", "./data/knowledge_base.js", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png"];
self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS))); });
self.addEventListener('activate', (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('message', (event) => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then((response) => { const copy=response.clone(); caches.open(CACHE_NAME).then((cache)=>cache.put('./index.html',copy)); return response; }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((response) => { if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request,response.clone())); return response; }).catch(() => cached);
    return cached || network;
  }));
});
