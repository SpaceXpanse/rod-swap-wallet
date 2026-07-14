const STATIC_CACHE_VERSION = "rod-wallet-static-v2.1.0-beta";
const STATIC_ASSET_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/bootstrap.min.css",
  "./css/bootstrap-datetimepicker.min.css",
  "./css/style.css",
  "./js/jquery-1.9.1.min.js",
  "./js/moment.min.js",
  "./js/transition.js",
  "./js/collapse.js",
  "./js/bootstrap.min.js",
  "./js/bootstrap-datetimepicker.min.js",
  "./js/crypto-min.js",
  "./js/crypto-sha256.js",
  "./js/crypto-sha256-hmac.js",
  "./js/sha512.js",
  "./js/ripemd160.js",
  "./js/aes.js",
  "./js/qrcode.js",
  "./js/qcode-decoder.min.js",
  "./js/jsbn.js",
  "./js/ellipticcurve.js",
  "./js/coin.js",
  "./js/coinbin.js",
  "./images/icon-32.png",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./images/icon-512-maskable.png",
  "./images/coinbin.png",
  "./images/about.png"
];

self.addEventListener("install", (installEvent) => {
  installEvent.waitUntil(
    caches.open(STATIC_CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSET_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (activateEvent) => {
  activateEvent.waitUntil(
    caches.keys().then((cacheKeys) =>
      Promise.all(
        cacheKeys
          .filter((cacheKey) => cacheKey !== STATIC_CACHE_VERSION)
          .map((cacheKey) => caches.delete(cacheKey))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (fetchEvent) => {
  if (fetchEvent.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(fetchEvent.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  fetchEvent.respondWith(
    caches.match(fetchEvent.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(fetchEvent.request).then((networkResponse) => {
        const isBasicResponse = networkResponse && networkResponse.status === 200 && networkResponse.type === "basic";

        if (!isBasicResponse) {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();
        caches.open(STATIC_CACHE_VERSION).then((cache) => cache.put(fetchEvent.request, responseClone));

        return networkResponse;
      });
    })
  );
});
