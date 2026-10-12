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
      // Browser storage is optional: quota/private-mode failures must never
      // turn a successful network download into a failed resource request.
      let cache;
      try { cache = await caches.open(CACHE); } catch { /* Continue online. */ }
      const cached = async () => {
        try { return await cache?.match(event.request); } catch { /* Continue online. */ }
      };
      // Bundle URLs include the file content hash, so a cache hit is already
      // the exact requested version. Avoid paying network latency again in
      // the live worker and on subsequent visits.
      const immutable = url.pathname.startsWith(new URL("./vendor/engine/bundles/", self.location.href).pathname)
        && /^[a-f0-9]{16,64}$/.test(url.searchParams.get("v") || "");
      let response = immutable ? await cached() : undefined;
      if (!response) {
        try {
          response = await fetch(event.request);
        } catch {
          response = await cached();
          if (!response) throw Error("Resource is unavailable online or in the offline cache: " + url.href);
        }
        if (response.ok && cache) {
          try { await cache.put(event.request, response.clone()); } catch { /* Keep the downloaded response. */ }
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
