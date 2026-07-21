'use strict';

// ============================================================================
// FIREBASE BAĞLANTISI (Realtime Database) — js/08-senkron-katmani.js'deki
// syncOku/syncYaz'ı Realtime Database'e yönlendirir. Bu dosya YÜKLENDİĞİNDE
// (index.html'de 08'den SONRA gelir), aşağıdaki kod syncOku/syncYaz
// fonksiyonlarını RTDB SÜRÜMÜYLE EZER (override) — 08-senkron-katmani.js'in
// geri kalanı (subeAtamalariniYukle, vknSubesiniAta, vb.) hiç değişmeden,
// bu yeni syncOku/syncYaz'ı kullanmaya devam eder.
//
// Çevrimdışı/RTDB'ye erişilemezse: IndexedDB'ye (idbGet/idbSet, 01-cekirdek.js)
// otomatik düşer — uygulama internetsiz de çalışmaya devam eder, sadece o an
// diğer cihazlarla senkron olmaz.
//
// Veri yolu: /kv/{anahtar} — her anahtar (örn. "efaturaPanelKaynaklar_v1")
// altında {deger, guncellemeZamani, cihazId, erisimAnahtari} saklanır.
// database.rules.json bu yolun yazımını erisimAnahtari alanına göre kontrol eder.
// ============================================================================

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDw9MxpQl8WkVvK7cJV_Re12_2_YxTnagc",
  authDomain: "fatura-kontrol-786a3.firebaseapp.com",
  databaseURL: "https://fatura-kontrol-786a3-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fatura-kontrol-786a3",
  storageBucket: "fatura-kontrol-786a3.firebasestorage.app",
  messagingSenderId: "428607579446",
  appId: "1:428607579446:web:4cd88093ecee151ce2ff97",
};

const ERISIM_ANAHTARI_STORAGE_KEY = 'efaturaPanelErisimAnahtari_v1';
const KV_YOLU = 'kv';

let _rtdb = null;
let _firebaseHazirMi = false;
let _erisimAnahtari = null; // tarayıcıda bir kere girilir, sonra localStorage'da saklanır

function firebaseSdkYuklendiMi(){
  return typeof window.firebase !== 'undefined' && typeof window.firebase.database === 'function';
}

async function firebaseBaslat(){
  if(_firebaseHazirMi) return true;
  if(!firebaseSdkYuklendiMi()){
    console.warn('Firebase SDK yüklenemedi — sadece yerel (IndexedDB) modda çalışılacak.');
    return false;
  }
  try{
    if(!window.firebase.apps.length){
      window.firebase.initializeApp(FIREBASE_CONFIG);
    }
    _rtdb = window.firebase.database();
    _firebaseHazirMi = true;
    return true;
  }catch(e){
    console.warn('Firebase başlatılamadı, yerel moda düşülüyor:', e);
    return false;
  }
}

// RTDB anahtarları '.', '#', '$', '[', ']' karakterlerini kabul etmez — uygulamanın
// kendi storage anahtarları (örn. efaturaPanelKaynaklar_v1) zaten güvenli ama yine
// de savunma amaçlı temizliyoruz.
function rtdbYoluGuvenliHalGetir(anahtar){
  return String(anahtar).replace(/[.#$\[\]]/g, '_');
}

// Erişim anahtarını localStorage'dan okur (varsa). Yoksa null döner — bu durumda
// yazma işlemleri başarısız olur ve kullanıcıya anahtar girme ekranı gösterilir.
function erisimAnahtariniAl(){
  if(_erisimAnahtari) return _erisimAnahtari;
  try{
    _erisimAnahtari = window.localStorage.getItem(ERISIM_ANAHTARI_STORAGE_KEY) || null;
  }catch(e){ _erisimAnahtari = null; }
  return _erisimAnahtari;
}

function erisimAnahtariniKaydet(anahtar){
  _erisimAnahtari = anahtar;
  try{ window.localStorage.setItem(ERISIM_ANAHTARI_STORAGE_KEY, anahtar); }catch(e){}
}

function erisimAnahtariniTemizle(){
  _erisimAnahtari = null;
  try{ window.localStorage.removeItem(ERISIM_ANAHTARI_STORAGE_KEY); }catch(e){}
}

// ===== syncYaz / syncOku — 08-senkron-katmani.js'deki sürümleri EZER =====
// RTDB'ye yazmayı DENER; başarısız olursa (anahtar yanlış, bağlantı yok vb.)
// sessizce IndexedDB'ye yazar ve hatayı konsola loglar — kullanıcının işi asla
// tamamen durmaz, en kötü ihtimalle o cihaz "yerel modda" kalmış olur.
// Firebase Realtime Database, JavaScript Date objelerini DESTEKLEMEZ — .set() çağrısına
// gerçek bir Date nesnesi geçilirse ya sessizce boş kaydedilir ya da hata verir. Ancak
// excelDateToJS (01-cekirdek.js) faturaTarihi alanları için hep gerçek Date döndürüyor,
// ve bu Date nesneleri rapor/dönem arşivi gibi büyük objelerin içine derin gömülü oluyor.
// Bu fonksiyon, kaydetmeden ÖNCE objenin içindeki HER Date nesnesini ISO string'e çevirir
// (JSON.stringify zaten Date'leri toISOString ile stringe çevirir — bunu JSON round-trip
// ile garantiye alıyoruz, RTDB'ye "temiz", tamamen JSON-uyumlu bir obje gönderiliyor).
function derinDateTemizle(deger){
  if(deger === undefined) return null; // RTDB undefined kabul etmez
  return JSON.parse(JSON.stringify(deger));
}

async function syncYaz(anahtar, deger){
  const cihazId = await cihazIdAl();
  const temizDeger = derinDateTemizle(deger);
  const sarmal = {
    deger: temizDeger,
    guncellemeZamani: new Date().toISOString(),
    cihazId,
  };

  const firebaseVarMi = await firebaseBaslat();
  const erisimAnahtari = erisimAnahtariniAl();

  if(firebaseVarMi && erisimAnahtari){
    try{
      const yol = KV_YOLU + '/' + rtdbYoluGuvenliHalGetir(anahtar);
      await _rtdb.ref(yol).set({
        ...sarmal,
        erisimAnahtari, // güvenlik kurallarının kontrol ettiği alan
      });
      await idbSet(anahtar, sarmal); // yerel yedek/önbellek olarak da tut (çevrimdışı okuma için)
      buluttaBaglantiDurumunuGuncelle(true);
      return sarmal;
    }catch(e){
      console.warn(`RTDB'ye yazılamadı (${anahtar}), yerel depoya düşülüyor:`, e);
      buluttaBaglantiDurumunuGuncelle(false, e);
    }
  }

  await idbSet(anahtar, sarmal);
  return sarmal;
}

async function syncOku(anahtar, varsayilan){
  const firebaseVarMi = await firebaseBaslat();

  if(firebaseVarMi){
    try{
      const yol = KV_YOLU + '/' + rtdbYoluGuvenliHalGetir(anahtar);
      const anlikGoruntu = await _rtdb.ref(yol).once('value');
      const veri = anlikGoruntu.val();
      if(veri && 'deger' in veri){
        await idbSet(anahtar, {deger: veri.deger, guncellemeZamani: veri.guncellemeZamani, cihazId: veri.cihazId});
        buluttaBaglantiDurumunuGuncelle(true);
        return veri.deger;
      }
      buluttaBaglantiDurumunuGuncelle(true);
    }catch(e){
      console.warn(`RTDB'den okunamadı (${anahtar}), yerel depodan okunuyor:`, e);
      buluttaBaglantiDurumunuGuncelle(false, e);
    }
  }

  try{
    const sarmal = await idbGet(anahtar);
    if(!sarmal || typeof sarmal !== 'object' || !('deger' in sarmal)) return varsayilan;
    return sarmal.deger;
  }catch(e){
    return varsayilan;
  }
}

// ===== Bağlantı durumu göstergesi (topbar'da küçük bir rozet için) =====
let _sonBulutDurumu = null; // true: bağlı, false: hata, null: hiç denenmedi
function buluttaBaglantiDurumunuGuncelle(basariliMi, hata){
  _sonBulutDurumu = basariliMi;
  const rozet = document.getElementById('bulutDurumRozeti');
  if(!rozet) return;
  if(basariliMi){
    rozet.className = 'bulut-durum ok';
    rozet.innerHTML = '<i class="fa-solid fa-cloud-arrow-up" aria-hidden="true"></i> Bulutta senkron';
    rozet.title = 'Veriler Realtime Database üzerinden diğer cihazlara da anlık yansıyor.';
  }else{
    rozet.className = 'bulut-durum hata';
    rozet.innerHTML = '<i class="fa-solid fa-cloud-slash" aria-hidden="true"></i> Yerel mod';
    rozet.title = 'Bulut bağlantısı kurulamadı — veriler şu an sadece bu cihazda saklanıyor. ' + (hata ? String(hata.message||hata) : '');
  }
}

// ===== Erişim anahtarı girme ekranı =====
// İlk açılışta (veya anahtar yanlışsa) bir kere sorulur; doğru girilince
// localStorage'a kaydedilir ve bir daha sorulmaz (o tarayıcıda).
function erisimAnahtariModaliGoster(hataMesaji){
  if(document.getElementById('erisimAnahtariOverlay')) return; // zaten açık
  const overlay = document.createElement('div');
  overlay.className = 'upload-overlay';
  overlay.id = 'erisimAnahtariOverlay';
  overlay.innerHTML = `
    <div class="upload-modal" style="max-width:360px;">
      <div class="upload-modal-head">
        <div class="upload-modal-title">Erişim Anahtarı</div>
      </div>
      <div style="color:rgba(255,255,255,.65); font-size:12.5px; margin-bottom:14px; line-height:1.6;">
        Bu panel bulutta (Firebase Realtime Database) saklanıyor ve birden fazla cihazdan erişilebiliyor.
        Devam etmek için erişim anahtarını girin.
      </div>
      ${hataMesaji ? `<div style="background:rgba(226,62,62,.15);border:1px solid rgba(226,62,62,.35);color:#FF9494;border-radius:8px;padding:9px 11px;font-size:12px;margin-bottom:12px;">${escapeHtml(hataMesaji)}</div>` : ''}
      <input type="password" id="erisimAnahtariInput" class="fatura-not-alani" style="min-height:auto;padding:11px 12px;" placeholder="Erişim anahtarını girin" autocomplete="off">
      <button type="button" class="upload-build-btn" id="btnErisimAnahtariGonder" style="margin-top:14px;">
        <i class="fa-solid fa-unlock" aria-hidden="true"></i> Devam et
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = document.getElementById('erisimAnahtariInput');
  const gonderBtn = document.getElementById('btnErisimAnahtariGonder');
  input.focus();

  async function dene(){
    const deger = input.value.trim();
    if(!deger) return;
    erisimAnahtariniKaydet(deger);
    // Anahtarın gerçekten doğru olup olmadığını anlamak için küçük bir test yazması
    // yapıyoruz — yanlışsa RTDB kuralları reddedecek (permission_denied) ve catch'e düşecek.
    gonderBtn.disabled = true;
    gonderBtn.textContent = 'Kontrol ediliyor…';
    try{
      const firebaseVarMi = await firebaseBaslat();
      if(!firebaseVarMi){
        overlay.remove();
        return; // Firebase hiç yüklenemediyse yerel modda devam (anahtar kontrolü anlamsız)
      }
      await _rtdb.ref(KV_YOLU + '/_erisimTesti').set({
        deger: true,
        guncellemeZamani: new Date().toISOString(),
        erisimAnahtari: deger,
      });
      overlay.remove();
      buluttaBaglantiDurumunuGuncelle(true);
      if(typeof tumVeriyiYenidenYukleVeCiz === 'function') await tumVeriyiYenidenYukleVeCiz();
      if(typeof canliDinlemeBaslat === 'function') await canliDinlemeBaslat();
    }catch(e){
      erisimAnahtariniTemizle();
      overlay.remove();
      erisimAnahtariModaliGoster('Anahtar yanlış görünüyor, tekrar deneyin.');
    }
  }

  gonderBtn.addEventListener('click', dene);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') dene(); });
}

// Uygulama açılışında bir kere çağrılır: anahtar yoksa modalı gösterir.
async function erisimKontroluBaslat(){
  const firebaseVarMi = await firebaseBaslat();
  if(!firebaseVarMi) return; // Firebase yoksa (offline/SDK yüklenmedi) sessizce yerel modda devam
  const anahtar = erisimAnahtariniAl();
  if(!anahtar){
    erisimAnahtariModaliGoster(null);
  }
}

// ============================================================================
// CANLI DİNLEME (gerçek zamanlı çoklu cihaz senkronu)
//
// Her izlenen anahtar için RTDB'nin kendi canlı olay akışına (`on('value', ...)`)
// abone oluyoruz. Başka bir cihaz o anahtara yazınca Firebase bu callback'i
// OTOMATİK tetikler — sayfa yenilemeye gerek kalmaz.
//
// ÖNEMLİ: Kendi yaptığımız yazma da bu callback'i tetikler (RTDB'nin doğası böyle).
// Kendi cihazımızın kendi yazdığı veriyi "değişiklik geldi" diye tekrar işleyip
// gereksiz render/olası döngüye girmemek için gelen kaydın `cihazId`'sini kendi
// `cihazId`'mizle karşılaştırıyoruz — farklıysa (yani GERÇEKTEN başka bir cihazdan
// geldiyse) state'i güncelleyip ekranı yeniden çiziyoruz.
// ============================================================================

const CANLI_DINLENEN_ANAHTARLAR = [
  'efaturaPanelKaynaklar_v1',
  'efaturaPanelManuel_v1',
  'efaturaPanelSonRapor_v1',
  'efaturaPanelDonemler_v1',
  'efaturaPanelSubeAtamalari_v1',
];

let _canliDinlemeAktifMi = false;
const _aktifDinleyiciRefleri = [];

async function canliDinlemeBaslat(){
  if(_canliDinlemeAktifMi) return; // birden fazla kez çağrılırsa tekrar abone olma
  const firebaseVarMi = await firebaseBaslat();
  if(!firebaseVarMi) return; // Firebase yoksa canlı dinleme de yok, sorun değil (yerel mod)

  const kendiCihazId = await cihazIdAl();
  _canliDinlemeAktifMi = true;

  CANLI_DINLENEN_ANAHTARLAR.forEach((anahtar)=>{
    const yol = KV_YOLU + '/' + rtdbYoluGuvenliHalGetir(anahtar);
    const ref = _rtdb.ref(yol);
    ref.on('value', (anlikGoruntu)=>{
      const veri = anlikGoruntu.val();
      if(!veri || !('deger' in veri)) return;
      if(veri.cihazId === kendiCihazId) return; // kendi yazdığımız değişiklik, yoksay

      // Başka bir cihazdan gelen değişiklik: önce yerel önbelleği (IndexedDB) güncelle,
      // sonra ilgili anahtara göre state'i tazeleyip SADECE o bölümü yeniden çiz.
      idbSet(anahtar, {deger: veri.deger, guncellemeZamani: veri.guncellemeZamani, cihazId: veri.cihazId})
        .then(()=> canliGuncellemeUygula(anahtar, veri.deger))
        .catch((e)=> console.warn('Canlı güncelleme yerel önbelleğe yazılamadı:', e));
    }, (hata)=>{
      console.warn(`Canlı dinleme hatası (${anahtar}):`, hata);
    });
    _aktifDinleyiciRefleri.push({ref, anahtar});
  });
}

function canliDinlemeDurdur(){
  _aktifDinleyiciRefleri.forEach(({ref})=> ref.off());
  _aktifDinleyiciRefleri.length = 0;
  _canliDinlemeAktifMi = false;
}

// Başka bir cihazdan gelen değişikliği ilgili state alanına uygulayıp SADECE o
// bölümün render fonksiyonlarını çağırır — tüm sayfayı yeniden yüklemez, kullanıcının
// o an baktığı filtre/sekme/scroll konumu bozulmaz.
function canliGuncellemeUygula(anahtar, yeniDeger){
  const bildirimMetni = canliBildirimGoster;
  switch(anahtar){
    case 'efaturaPanelKaynaklar_v1':
      Object.assign(state.kaynaklar, yeniDeger);
      if(typeof renderUploadPanels === 'function') renderUploadPanels();
      if(typeof guncelleRaporOlusturButonu === 'function') guncelleRaporOlusturButonu();
      bildirimMetni('Veri kaynakları başka bir cihazda güncellendi.');
      break;
    case 'efaturaPanelManuel_v1':
      state.manuel = yeniDeger || {};
      if(state.rapor){
        state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari);
        yenidenCizVeBildir('Manuel işaretler başka bir cihazda güncellendi.');
      }
      break;
    case 'efaturaPanelSonRapor_v1':
      // Sadece BAŞKA bir cihazın "Raporu Oluştur"a bastığı an güncel rapor değişir;
      // biz arşiv görünümündeysek (goruntulenenDonemId doluysa) ekranı BOZMAYIZ.
      if(!state.goruntulenenDonemId && yeniDeger && yeniDeger.rapor){
        state.rapor = raporEksikAlanlariTamamla(yeniDeger.rapor);
        yenidenCizVeBildir('Rapor başka bir cihazda güncellendi.');
      }
      break;
    case 'efaturaPanelDonemler_v1':
      state.donemler = yeniDeger || {};
      if(typeof renderDonemPaneli === 'function') renderDonemPaneli();
      bildirimMetni('Dönem arşivi başka bir cihazda güncellendi.');
      break;
    case 'efaturaPanelSubeAtamalari_v1':
      state.subeAtamalari = new Map(Object.entries(yeniDeger || {}));
      if(state.rapor){
        state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari);
        yenidenCizVeBildir('Şube ataması başka bir cihazda güncellendi.');
      }
      break;
  }
}

function yenidenCizVeBildir(mesaj){
  if(typeof renderKPIs === 'function') renderKPIs();
  if(typeof renderGroupTabs === 'function') renderGroupTabs();
  if(typeof renderGroupSections === 'function') renderGroupSections();
  if(typeof renderDonemPaneli === 'function') renderDonemPaneli();
  canliBildirimGoster(mesaj);
}

// Ekranın sağ altında 2-3 saniyeliğine görünüp kaybolan küçük bir "toast" bildirimi —
// kullanıcı neden ekranın kendiliğinden değiştiğini anlasın diye. DOM'a erişim
// başarısız olursa (beklenmeyen bir tarayıcı/ortam farkı) sessizce geçilir — bildirim
// gösterilememesi state güncellemesini asla etkilememeli.
let _canliBildirimZamanlayici = null;
function canliBildirimGoster(mesaj){
  try{
    let el = document.getElementById('canliSenkronBildirimi');
    if(!el){
      el = document.createElement('div');
      el.id = 'canliSenkronBildirimi';
      el.className = 'canli-senkron-bildirim';
      document.body.appendChild(el);
    }
    el.innerHTML = `<i class="fa-solid fa-cloud-arrow-down" aria-hidden="true"></i> ${escapeHtml(mesaj)}`;
    el.classList.add('gorunur');
    clearTimeout(_canliBildirimZamanlayici);
    _canliBildirimZamanlayici = setTimeout(()=>{ el.classList.remove('gorunur'); }, 3200);
  }catch(e){
    console.warn('Canlı senkron bildirimi gösterilemedi:', e);
  }
}
