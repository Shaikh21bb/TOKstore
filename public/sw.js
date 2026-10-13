const CACHE='tok-shell-v3';
const CORE=['/','/style.css','/store-plus.css','/app.js','/manifest.webmanifest','/assets/favicon.svg','/assets/hero.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const request=event.request;if(request.method!=='GET'||new URL(request.url).origin!==location.origin)return;if(new URL(request.url).pathname.startsWith('/api/')){event.respondWith(fetch(request));return}event.respondWith(caches.match(request).then(cached=>{const fresh=fetch(request).then(response=>{if(response.ok)caches.open(CACHE).then(cache=>cache.put(request,response.clone()));return response}).catch(()=>cached);return cached||fresh}))});
