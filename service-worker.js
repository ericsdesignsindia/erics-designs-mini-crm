const CACHE='erics-crm-v20260919-63';
const ASSETS=['./','./index.html','./style.css?v=20260919-63','./crm.css?v=20260919-63','./billing.js?v=20260919-63','./crm.js?v=20260919-63','./api-sync.js?v=20260919-63','./site.webmanifest','./ed-icon-192.png','./ed-icon-512.png','./assets/erics-designs-crm-logo.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const isAppAsset=new URL(event.request.url).origin===location.origin;
  if(!isAppAsset)return;
  event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));return response}).catch(()=>caches.match(event.request,{ignoreSearch:false})));
});