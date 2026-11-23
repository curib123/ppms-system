/* Cache only the public application shell. API responses and credentials never enter Cache Storage. */
const SCOPE=new URL(self.registration.scope).pathname;
const CACHE_PREFIX=`ppms-shell-${encodeURIComponent(SCOPE)}-`;
const CACHE=`${CACHE_PREFIX}v5`;
const SHELL=['mobile','admin','manifest.webmanifest','assets/ppms/app.js','assets/ppms/api.js',
  'assets/ppms/schema.js','assets/ppms/renderer.js','assets/ppms/viewport.js','assets/ppms/builder.js',
  'assets/ppms/ui.js','assets/ppms/dom.js','assets/ppms/controls.js','assets/ppms/theme.js',
  'assets/ppms/records.js','assets/ppms/admin.js','assets/ppms/offline.js','assets/ppms/styles.css',
  'assets/ppms/theme.css','assets/ppms/base.css','assets/ppms/workspace.css','assets/ppms/auth.css',
  'assets/ppms/document.css','assets/ppms/admin.css','assets/ppms/controls.css','assets/ppms/system.css',
  'assets/ppms/responsive.css',
  'assets/ppms/login-cover.webp','assets/ppms/icon-192.svg','assets/ppms/icon-512.svg'].map(path=>SCOPE+path);
self.addEventListener('install',event=>{
  // Wait for existing tabs to close before replacing their shell; never reload an active editor.
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)));
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith(CACHE_PREFIX)&&name!==CACHE)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith(SCOPE+'api/')||!SHELL.includes(url.pathname))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(url.pathname,response.clone());}return response;})
      .catch(async()=>{const cached=await caches.match(url.pathname);return cached||new Response('Open PPMS online once to enable offline access.',{status:503,headers:{'Content-Type':'text/plain'}});}));
  }else{
    event.respondWith(caches.match(url.pathname).then(cached=>cached||fetch(request).then(async response=>{if(response.ok){const cache=await caches.open(CACHE);await cache.put(url.pathname,response.clone());}return response;})));
  }
});
