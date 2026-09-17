const CACHE='erics-crm-v20260917-13';
const ASSETS=['./','./index.html','./style.css?v=20260917-13','./crm.css?v=20260917-13','./billing.js?v=20260917-13','./crm.js?v=20260917-13','./api-sync.js?v=20260917-13','./site.webmanifest','./ed-icon-192.png','./ed-icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request,{ignoreSearch:false}).then(cached=>cached||fetch(event.request).then(response=>{const copy=response.clone();if(new URL(event.request.url).origin===location.origin)caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>cached)))});
