/**
 * Routine Gen - Service Worker (Offline Cache-First Architecture)
 *
 * Provides complete offline capabilities for scheduling, conflict resolution,
 * Excel import/export (SheetJS), and PDF timetable rendering (jsPDF).
 */

const CACHE_NAME = 'routinegen-cache-v6';

// All critical core pages, assets, and external CDN dependencies
const PRECACHE_ASSETS = [
  // Core Routes
  '/',
  '/index.html',
  '/json-import.html',
  '/help.html',
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/llms-full.txt',

  // Local Stylesheets
  '/css/styles.css',
  '/css/json-import.css',

  // Local Application Scripts
  '/js/app.js',
  '/js/excel-import.js',
  '/js/json-import.js',

  // Local Icons & Graphics
  '/favicon.svg',
  '/assets/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-512-maskable.png',

  // External CDN Dependencies (Precached for 100% Offline Excel & PDF Operations)
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// Install Event: Pre-cache all core pages, assets, and CDNs
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Use Promise.allSettled so an individual CDN hitch doesn't abort worker installation
      const promises = PRECACHE_ASSETS.map(async (url) => {
        try {
          const req = new Request(url, { mode: url.startsWith('http') ? 'cors' : 'same-origin' });
          const res = await fetch(req);
          if (res.ok || res.type === 'opaque') {
            await cache.put(req, res);
          }
        } catch (err) {
          console.warn('[ServiceWorker] Pre-cache item failed:', url, err);
        }
      });
      await Promise.allSettled(promises);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old versions and claim clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[ServiceWorker] Clearing obsolete cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Cache-First with Dynamic Network Fallback
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      // If not in cache, fetch over network and cache the response
      return fetch(event.request)
        .then((networkResponse) => {
          // Verify valid response
          if (!networkResponse || networkResponse.status !== 200 || (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')) {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // Offline navigation fallback: return index.html for page navigation if specific page missing
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
});

