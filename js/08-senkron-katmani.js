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
