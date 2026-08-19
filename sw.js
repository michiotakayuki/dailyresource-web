/* DailyResource service worker — v2
   Perubahan dari v1:
   - Halaman aplikasi (.html) sekarang AMBIL DARI INTERNET DULU.
     Jadi begitu ada pembaruan, pembeli langsung dapat versi terbaru
     saat itu juga — tidak lagi telat satu kali buka.
   - Kalau sedang tidak ada sinyal, otomatis pakai simpanan terakhir,
     jadi kemampuan offline tetap jalan seperti sebelumnya.
   - Aset berat (video, gambar, font) tetap diambil dari simpanan dulu
     supaya cepat & hemat kuota, lalu diperbarui diam-diam di belakang.
*/
const C = "dr-cache-v2";
const NET_TIMEOUT = 6000; // ms — kalau internet lemot, jangan bikin app menggantung

self.addEventListener("install", e => self.skipWaiting());

self.addEventListener("activate", e => e.waitUntil((async () => {
  // buang cache versi lama supaya tidak ada sisa file usang
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== C).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(req).then(
      r => { clearTimeout(t); resolve(r); },
      err => { clearTimeout(t); reject(err); }
    );
  });
}

function isPage(req, url) {
  return req.mode === "navigate"
      || req.destination === "document"
      || url.pathname.endsWith(".html")
      || url.pathname === "/";
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return; // biarkan request ke domain lain apa adanya

  e.respondWith((async () => {
    const cache = await caches.open(C);

    // ---- HALAMAN APLIKASI: internet dulu, simpanan sebagai cadangan ----
    if (isPage(req, url)) {
      try {
        const net = await fetchWithTimeout(req, NET_TIMEOUT);
        if (net && net.ok) cache.put(req, net.clone()).catch(() => {});
        return net;
      } catch (_) {
        const cached = await cache.match(req);
        if (cached) return cached;
        return new Response(
          "<meta charset='utf-8'><p style=\"font-family:system-ui;padding:24px\">Sedang tidak ada koneksi, dan halaman ini belum pernah tersimpan. Coba lagi saat online.</p>",
          { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
        );
      }
    }

    // ---- ASET LAIN: simpanan dulu, perbarui diam-diam ----
    const cached = await cache.match(req);
    const net = fetch(req).then(r => {
      if (r && r.ok) cache.put(req, r.clone()).catch(() => {});
      return r;
    }).catch(() => cached);

    return cached || net;
  })());
});
