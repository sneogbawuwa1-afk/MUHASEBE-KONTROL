'use strict';

// Sürüm numarasını her önemli statik dosya değişikliğinde artır — eski önbellek
// otomatik temizlenir (activate aşamasında).
const CACHE_SURUMU = 'efatura-panel-v10';
const ONBELLEK_DOSYALARI = [
  './',
  './index.html',
  './styles.css',
  './js/01-cekirdek.js',
  './js/02-veri-yukleme.js',
  './js/03-eslestirme.js',
  './js/04-genel-bakis.js',
  './js/05-uygulama.js',
  './js/06-pwa.js',
  './js/07-donem-arsivi.js',
  './js/08-senkron-katmani.js',
  './js/09-firebase.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_SURUMU).then((cache)=> cache.addAll(ONBELLEK_DOSYALARI))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then((anahtarlar)=>
      Promise.all(anahtarlar.filter((k)=> k !== CACHE_SURUMU).map((k)=> caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Strateji: statik dosyalar (app shell) için "önce önbellek, arkaplanda güncelle";
// CDN üzerinden gelen xlsx/font/ikon kütüphaneleri için "önce ağ, olmazsa önbellek".
// Not: kullanıcı verisi (Excel yüklemeleri, rapor) zaten IndexedDB'de saklanıyor,
// service worker sadece uygulamanın KENDİSİNİN (kod/stil) offline açılabilmesini sağlar.
self.addEventListener('fetch', (event)=>{
  const req = event.request;
  if(req.method !== 'GET') return;

  const url = new URL(req.url);
  const ayniOrijin = url.origin === self.location.origin;

  if(ayniOrijin){
    event.respondWith(
      caches.match(req).then((onbellekYaniti)=>{
        const agFetch = fetch(req).then((agYaniti)=>{
          if(agYaniti && agYaniti.ok){
            const kopya = agYaniti.clone();
            caches.open(CACHE_SURUMU).then((cache)=> cache.put(req, kopya));
          }
          return agYaniti;
        }).catch(()=> onbellekYaniti);
        return onbellekYaniti || agFetch;
      })
    );
  }else{
    event.respondWith(
      fetch(req).catch(()=> caches.match(req))
    );
  }
});
