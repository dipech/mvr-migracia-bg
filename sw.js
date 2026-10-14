// Only same-origin static application files are cached. Migration responses never enter Cache Storage.
const CACHE = 'migration-shell-c9ac860a8e97';
const BUILD_ASSETS = ["assets/Scanner-D5qiNou2.js","assets/index-BwMN_msY.css","assets/index-DrmG0B9h.js"];
const ROOT = new URL('./', self.location.href).href;
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch(ROOT, {cache:'reload'});
    if (!response.ok) throw new Error('Shell unavailable');
    const html = await response.clone().text();
    await cache.put(ROOT, response);
    const resources = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m => new URL(m[1],ROOT).href).filter(u => new URL(u).origin === self.location.origin);
    await cache.addAll([...new Set([...resources, ...BUILD_ASSETS.map(p => new URL(p, ROOT).href), ...['icon-192.png', 'icon-512.png', 'icon.svg', 'manifest.webmanifest'].map(p => new URL(p, ROOT).href)])]);
  })());
});
self.addEventListener('activate', event => event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith('migration-shell-')&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin || event.request.method!=='GET')return;
  if(event.request.mode==='navigate') {
    event.respondWith(fetch(event.request).catch(async()=> (await caches.open(CACHE)).match(ROOT)));
  } else {
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE),saved=await cache.match(event.request);
      if(saved)return saved;
      const response=await fetch(event.request);
      if(response.ok && /\.(js|css|png|svg|webmanifest)$/.test(url.pathname))await cache.put(event.request,response.clone());
      return response;
    })());
  }
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});if(windows[0])return windows[0].focus();return self.clients.openWindow(ROOT);})());
});
