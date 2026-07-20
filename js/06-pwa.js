'use strict';

// ===== PWA "Yükle" butonu =====
// Masaüstü Chrome/Edge ve Android Chrome: tarayıcı `beforeinstallprompt` olayını fırlatır,
// biz bunu yakalayıp kendi butonumuzla tetikleriz (tarayıcının varsayılan mini-infobar'ı yerine).
// iOS Safari: bu olay HİÇ desteklenmiyor — native yükleme yok, bunun yerine kullanıcıya
// "Paylaş > Ana Ekrana Ekle" adımlarını gösteren bir talimat kartı açıyoruz.
// Uygulama zaten yüklüyse (standalone modda açıldıysa) buton hiç gösterilmez.

let ertelenmisYuklemeOlayi = null;

function standaloneModdaMi(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS eski API
}

function iosCihazMi(){
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function yukleButonunuGoster(){
  const btn = document.getElementById('btnUygulamaYukle');
  if(!btn || standaloneModdaMi()) return;
  btn.hidden = false;
}

function yukleButonunuGizle(){
  const btn = document.getElementById('btnUygulamaYukle');
  if(btn) btn.hidden = true;
}

// Chrome/Edge (masaüstü + Android): tarayıcı "yüklenebilir" şartları karşılandığında
// bu olayı fırlatır. preventDefault ile varsayılan mini-infobar'ı engelleyip olayı
// saklıyoruz — kullanıcı kendi "Yükle" butonumuza basınca prompt() ile açıyoruz.
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  ertelenmisYuklemeOlayi = e;
  yukleButonunuGoster();
});

// Yükleme tamamlanınca (herhangi bir yoldan) buton kaybolsun.
window.addEventListener('appinstalled', ()=>{
  ertelenmisYuklemeOlayi = null;
  yukleButonunuGizle();
});

function iosYuklemeTalimatModaliAc(){
  const overlay = document.createElement('div');
  overlay.className = 'upload-overlay';
  overlay.innerHTML = `
    <div class="upload-modal" style="max-width:380px;">
      <div class="upload-modal-head">
        <div class="upload-modal-title">Ana Ekrana Ekle</div>
        <button type="button" class="upload-close" id="btnCloseIosYukle" aria-label="Kapat"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div class="ios-yukle-adim">
          <span class="ios-yukle-no">1</span>
          <span>Safari alt menüsünde <i class="fa-solid fa-arrow-up-from-bracket" aria-hidden="true"></i> <strong>Paylaş</strong> simgesine dokun.</span>
        </div>
        <div class="ios-yukle-adim">
          <span class="ios-yukle-no">2</span>
          <span>Açılan listede <strong>"Ana Ekrana Ekle"</strong> seçeneğini bul ve dokun.</span>
        </div>
        <div class="ios-yukle-adim">
          <span class="ios-yukle-no">3</span>
          <span>Sağ üstteki <strong>"Ekle"</strong> butonuna dokun — panel artık ana ekranında bir uygulama gibi duracak.</span>
        </div>
      </div>
      <div class="upload-note" style="margin-top:16px;">iOS henüz otomatik yükleme istemini desteklemiyor; bu adımlar Safari'nin kendi menüsünü kullanır.</div>
    </div>
  `;
  document.body.appendChild(overlay);
  function kapat(){ overlay.remove(); }
  overlay.querySelector('#btnCloseIosYukle').addEventListener('click', kapat);
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) kapat(); });
}

async function yukleButonunaTiklandi(){
  if(iosCihazMi() && !ertelenmisYuklemeOlayi){
    iosYuklemeTalimatModaliAc();
    return;
  }
  if(!ertelenmisYuklemeOlayi) return; // henüz şart oluşmadıysa sessizce çık
  ertelenmisYuklemeOlayi.prompt();
  try{
    await ertelenmisYuklemeOlayi.userChoice;
  }catch(e){}
  ertelenmisYuklemeOlayi = null;
  yukleButonunuGizle();
}

function pwaYukleBaslat(){
  if(standaloneModdaMi()) return; // zaten yüklü/standalone açılmışsa hiç uğraşma
  const btn = document.getElementById('btnUygulamaYukle');
  if(btn) btn.addEventListener('click', yukleButonunaTiklandi);
  // iOS'ta beforeinstallprompt hiç gelmeyeceği için butonu doğrudan gösteriyoruz;
  // tıklanınca talimat modalı açılır (yukarıdaki yukleButonunaTiklandi içinde).
  if(iosCihazMi()) yukleButonunuGoster();
}

document.addEventListener('DOMContentLoaded', pwaYukleBaslat);
