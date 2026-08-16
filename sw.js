const C="dr-cache-v1";
self.addEventListener("install",e=>self.skipWaiting());
self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET")return;
  e.respondWith(caches.open(C).then(async cache=>{
    const cached=await cache.match(e.request);
    const net=fetch(e.request).then(r=>{if(r&&r.ok)cache.put(e.request,r.clone());return r;}).catch(()=>cached);
    return cached||net;
  }));
});