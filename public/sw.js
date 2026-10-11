// Static-host isolation and an offline cache; no compilation service.
const CACHE = "rex-assets-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin
  )
    return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // Bundle URLs include the file content hash, so a cache hit is already
      // the exact requested version. Avoid paying network latency again in
      // the live worker and on subsequent visits.
      const immutable = url.pathname.startsWith(new URL("./vendor/engine/bundles/", self.location.href).pathname)
        && /^[a-f0-9]{16,64}$/.test(url.searchParams.get("v") || "");
      let response = immutable ? await cache.match(event.request) : undefined;
      if (!response) {
        try {
          response = await fetch(event.request);
          if (response.ok) await cache.put(event.request, response.clone());
        } catch {
          response = await cache.match(event.request);
          if (!response) throw Error("Resource is unavailable in the offline cache");
        }
      }
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    })(),
  );
});
