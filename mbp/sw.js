/* Quot-in Pengadaan — service worker.
   Tujuan: aplikasi tetap terbuka dan bisa dipakai walau tanpa internet.
   Data tetap disimpan Firestore (cache lokalnya sendiri), bukan di sini. */

const V = 'mbp-v2';
const SHELL = [
  './', './index.html', './app.js', './app.webmanifest',
  './ic-180.png', './ic-192.png', './ic-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => { })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);

  // Lalu lintas data & login: selalu lewat jaringan. Firestore punya cache sendiri.
  if (/googleapis\.com$|firebaseio\.com$|firebaseinstallations\.googleapis\.com$/.test(u.hostname)) return;

  // SDK Firebase dari gstatic: pakai cache dulu supaya aplikasi bisa dibuka offline.
  if (u.hostname === 'www.gstatic.com' || u.hostname === 'cdnjs.cloudflare.com') {
    e.respondWith((async () => {
      const c = await caches.open(V);
      const hit = await c.match(r);
      if (hit) { fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); }).catch(() => { }); return hit; }
      try { const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res; }
      catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Berkas aplikasi sendiri.
  if (u.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(V);
      if (r.mode === 'navigate') {
        try { const res = await fetch(r); if (res.ok) c.put('./index.html', res.clone()); return res; }
        catch (err) { return (await c.match('./index.html')) || (await c.match('./')) || new Response('Offline', { status: 503 }); }
      }
      const hit = await c.match(r, { ignoreSearch: true });
      if (hit) { fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); }).catch(() => { }); return hit; }
      try { const res = await fetch(r); if (res.ok) c.put(r, res.clone()); return res; }
      catch (err) { return new Response('', { status: 504 }); }
    })());
  }
});
