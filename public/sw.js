/* Authenticated pages stay network-only. Push payloads are navigation, not credentials. */
const CACHE = "commishhq-offline-v2";
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add("/offline.html")));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("commishhq-offline-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
});
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate" || event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).catch(async () => (await caches.match("/offline.html")) || Response.error()),
  );
});
self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const url = typeof payload.url === "string" && payload.url.startsWith("/") && !payload.url.startsWith("//")
    ? payload.url
    : "/";
  event.waitUntil(
    self.registration.showNotification(payload.title || "CommishHQ", {
      body: payload.body || "",
      data: { url },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url;
  const url = typeof target === "string" && target.startsWith("/") && !target.startsWith("//") ? target : "/";
  event.waitUntil(self.clients.openWindow(url));
});
