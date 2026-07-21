'use strict';

// ============================================================================
// SENKRON KATMANI — çoklu cihaz desteğine hazır soyutlama.
//
// Şu an hiçbir bulut bağlantısı YOK: syncOku/syncYaz sadece IndexedDB'yi kullanır,
// tek tarayıcıda çalışır. Ama uygulamanın geri kalanı doğrudan idbGet/idbSet çağırmak
// yerine BU katmanı çağırıyor — ileride Firebase (veya başka bir bulut backend'i)
// bağlanınca, tek yapılması gereken bu dosyadaki syncOku/syncYaz gövdesini
// Firestore çağrılarıyla değiştirmek olacak; geri kalan tüm kod (04, 05, 07...)
// HİÇ değişmeyecek.
//
// Her kayıt {deger, guncellemeZamani, cihazId} sarmalayıcısıyla saklanır — bu,
// ileride iki cihaz aynı VKN'yi aynı anda farklı şubeye atarsa "son yazan kazanır"
// (en yeni guncellemeZamani) çakışma çözümünü baştan mümkün kılar.
// ============================================================================

const CIHAZ_ID_STORAGE_KEY = 'efaturaPanelCihazId_v1';
let _cihazIdOnbellek = null;

async function cihazIdAl(){
  if(_cihazIdOnbellek) return _cihazIdOnbellek;
  try{
    let id = await idbGet(CIHAZ_ID_STORAGE_KEY);
    if(!id){
      id = 'cihaz-' + Math.random().toString(36).slice(2,10) + '-' + Date.now().toString(36);
      await idbSet(CIHAZ_ID_STORAGE_KEY, id);
    }
    _cihazIdOnbellek = id;
    return id;
  }catch(e){
    _cihazIdOnbellek = 'cihaz-bilinmiyor';
    return _cihazIdOnbellek;
  }
}

// syncYaz: bir anahtar altında değeri sarmalayıp kaydeder. Bugün: IndexedDB.
// Yarın (Firebase eklenince): aynı imza korunarak Firestore'a setDoc/updateDoc olur.
async function syncYaz(anahtar, deger){
  const cihazId = await cihazIdAl();
  const sarmal = {
    deger,
    guncellemeZamani: new Date().toISOString(),
    cihazId,
  };
  await idbSet(anahtar, sarmal);
  return sarmal;
}

// syncOku: sarmalayıcıdan değeri çıkarır. Kayıt yoksa varsayilan döner.
async function syncOku(anahtar, varsayilan){
  try{
    const sarmal = await idbGet(anahtar);
    if(!sarmal || typeof sarmal !== 'object' || !('deger' in sarmal)) return varsayilan;
    return sarmal.deger;
  }catch(e){
    return varsayilan;
  }
}

// ===== VKN → ŞUBE MANUEL ATAMASI =====
// state.subeAtamalari: Map<vkn(normalize), 'kesan'|'bayrampasa'>. Kalıcı, VKN bazında —
// hangi ay/dönem olursa olsun o VKN'ye ait tüm faturalar otomatik atanan şubeye düşer.
const SUBE_ATAMALARI_STORAGE_KEY = 'efaturaPanelSubeAtamalari_v1';

async function subeAtamalariniYukle(){
  const kayit = await syncOku(SUBE_ATAMALARI_STORAGE_KEY, {});
  state.subeAtamalari = new Map(Object.entries(kayit || {}));
}

async function subeAtamalariniKaydet(){
  const objeHali = Object.fromEntries(state.subeAtamalari);
  await syncYaz(SUBE_ATAMALARI_STORAGE_KEY, objeHali);
}

// Bir VKN'yi kalıcı olarak bir şubeye atar (veya atamayı kaldırır, grup=null verilirse).
// Her çağrı ANINDA arşive/depoya yazılır (senkron katmanı üzerinden) — kullanıcı başka
// bir cihazdan baktığında (Firebase bağlandığında) aynı kararı görecek şekilde tasarlandı.
async function vknSubesiniAta(vkn, grup){
  const normalizeVkn = normVKN(vkn);
  if(!normalizeVkn) return;
  if(grup === 'kesan' || grup === 'bayrampasa'){
    state.subeAtamalari.set(normalizeVkn, grup);
  }else{
    state.subeAtamalari.delete(normalizeVkn);
  }
  await subeAtamalariniKaydet();
}

function vknSubesiAtanmisMi(vkn){
  return state.subeAtamalari.get(normVKN(vkn)) || null;
}

// ===== ZİNCİR VKN LİSTESİ =====
// state.zincirVknListesi: Set<vkn(normalize)>. Migros gibi Türkiye genelinde tüm
// şubeleri aynı VKN'yi kullanan markalar için — bu VKN'ler otomatik Keşan/Bayrampaşa
// atamasından (Müşteri Master dahil) tamamen MUAF tutulur, her zaman "Kontrol"e düşer.
// Kullanıcı sidebar'dan istediği VKN'yi ekleyip çıkarabilir.
const ZINCIR_VKN_LISTESI_STORAGE_KEY = 'efaturaPanelZincirVknListesi_v1';

async function zincirVknListesiniYukle(){
  const kayit = await syncOku(ZINCIR_VKN_LISTESI_STORAGE_KEY, []);
  state.zincirVknListesi = new Set(Array.isArray(kayit) ? kayit : []);
}

async function zincirVknListesiniKaydet(){
  await syncYaz(ZINCIR_VKN_LISTESI_STORAGE_KEY, Array.from(state.zincirVknListesi));
}

// Bir VKN'yi zincir listesine ekler — bundan sonra bu VKN'ye ait TÜM faturalar
// (Müşteri Master'da olsa bile) otomatik olarak "Kontrol" grubuna düşer.
async function zincirVknEkle(vkn){
  const normalizeVkn = normVKN(vkn);
  if(!normalizeVkn) return;
  state.zincirVknListesi.add(normalizeVkn);
  await zincirVknListesiniKaydet();
}

// Bir VKN'yi zincir listesinden çıkarır — normal Müşteri Master/manuel VKN ataması
// mantığı bu VKN için tekrar geçerli olur.
async function zincirVknCikar(vkn){
  const normalizeVkn = normVKN(vkn);
  if(!normalizeVkn) return;
  state.zincirVknListesi.delete(normalizeVkn);
  await zincirVknListesiniKaydet();
}

function vknZincirMi(vkn){
  return state.zincirVknListesi.has(normVKN(vkn));
}

// ===== FATURA BAZLI GEÇİCİ ŞUBE ATAMASI =====
// state.faturaSubeAtamalari: Map<faturaKey, 'kesan'|'bayrampasa'>. VKN'den bağımsız,
// SADECE o faturaya özel geçici atama — zincir VKN'li (örn. Migros) faturalar Kontrol'e
// düştüğünde, her faturayı kendi başına elle atamak için kullanılır. Aynı VKN'nin başka
// bir faturasını (farklı ay, farklı mağaza) HİÇ etkilemez.
const FATURA_SUBE_ATAMALARI_STORAGE_KEY = 'efaturaPanelFaturaSubeAtamalari_v1';

async function faturaSubeAtamalariniYukle(){
  const kayit = await syncOku(FATURA_SUBE_ATAMALARI_STORAGE_KEY, {});
  state.faturaSubeAtamalari = new Map(Object.entries(kayit || {}));
}

async function faturaSubeAtamalariniKaydet(){
  const objeHali = Object.fromEntries(state.faturaSubeAtamalari);
  await syncYaz(FATURA_SUBE_ATAMALARI_STORAGE_KEY, objeHali);
}

// Bir faturayı (faturaKey ile) geçici olarak bir şubeye atar/atamayı kaldırır.
// vknSubesiniAta'dan farkı: bu SADECE bu faturaKey içindir, VKN bazında değildir.
async function faturaSubesiniAta(faturaKey, grup){
  if(!faturaKey) return;
  if(grup === 'kesan' || grup === 'bayrampasa'){
    state.faturaSubeAtamalari.set(faturaKey, grup);
  }else{
    state.faturaSubeAtamalari.delete(faturaKey);
  }
  await faturaSubeAtamalariniKaydet();
}

function faturaSubesiAtanmisMi(faturaKey){
  return state.faturaSubeAtamalari.get(faturaKey) || null;
}
