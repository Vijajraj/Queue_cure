const CACHE_NAME = "queue-cure-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png"
];

// Install Event
self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate Event
self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

// Fetch Event (App Shell caching strategy)
self.addEventListener("fetch", (e) => {
  // Only handle GET requests and skip socket.io or external APIs
  if (e.request.method !== "GET" || e.request.url.includes("/socket.io") || e.request.url.includes("api.qrserver.com")) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(e.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (e.request.mode === "navigate") {
          return caches.match("/index.html") || caches.match("/");
        }
      });
    })
  );
});
