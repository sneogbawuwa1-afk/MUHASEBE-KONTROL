'use strict';

const state = {
  kaynaklar: {
    earsiv: null,
    efaturaQnb: null,
    efaturaLogo: null,
    musteriKesan: null,
    musteriBayrampasa: null,
    efesEkstre: null,
    netsis: null,
  },
  rapor: null,
  manuel: {},
  // Dönem arşivi: her "Raporu Oluştur" çağrısında o anki raporun bir kopyası
  // ay-yıl anahtarıyla (örn. "2026-06") burada tutulur — geçmiş dönem karşılaştırması,
  // gün bazlı boşluk kontrolü ve "geçmişe eklenen Netsis kaydı" uyarısı bunu kullanır.
  donemler: {},
  goruntulenenDonemId: null, // null => en güncel/canlı rapor; doluysa arşivden salt-görüntüleme
  // VKN -> şube (kesan/bayrampasa) manuel kalıcı ataması. Kontrol grubundaki bir fatura
  // elle bir şubeye atanınca, o VKN'ye ait TÜM faturalar (geçmiş/gelecek dönem fark etmez)
  // otomatik olarak o şubeye düşer. Map<vkn, 'kesan'|'bayrampasa'>. Senkron katmanı
  // (js/08-senkron-katmani.js) üzerinden okunur/yazılır — çoklu cihaz desteğine hazır.
  subeAtamalari: new Map(),
};

const STORAGE_KEY = 'efaturaPanelKaynaklar_v1';
const MANUEL_STORAGE_KEY = 'efaturaPanelManuel_v1';

const TUTAR_TOLERANS_STORAGE_KEY = 'efaturaPanelTutarTolerans_v1';

function normVKN(v){

  const digits = String(v==null?'':v).replace(/\D/g,'');
  return digits.replace(/^0+/,'') || (digits ? '0' : '');
}

function parseFaturaNo(fn){

  const s = String(fn==null?'':fn).trim().toUpperCase();
  const m = s.match(/^([A-Z]+)(\d+)$/);
  if(!m) return {prefix:s, digits:'', ayristirilamadi:true};
  return {prefix:m[1], digits:m[2], ayristirilamadi:false};
}

function normFaturaKey(fn){

  const {prefix, digits} = parseFaturaNo(fn);
  return prefix + '|' + digits;
}

function digitsYakinMi(a, b){

  if(a === b) return true;
  if(Math.abs(a.length - b.length) !== 1) return false;
  const uzun = a.length > b.length ? a : b;
  const kisa = a.length > b.length ? b : a;
  for(let i=0; i<=kisa.length; i++){
    const aday = kisa.slice(0,i) + '0' + kisa.slice(i);
    if(aday === uzun) return true;
  }
  return false;
}

function faturaNoYakinMi(fn1, fn2){
  const p1 = parseFaturaNo(fn1);
  const p2 = parseFaturaNo(fn2);
  if(p1.prefix !== p2.prefix) return false;
  return digitsYakinMi(p1.digits, p2.digits);
}

function matchKey(vkn, faturaNo){
  return normVKN(vkn) + '::' + normFaturaKey(faturaNo);
}

function toNumber(v){
  if(v==null || v==='') return 0;
  if(typeof v==='number') return v;
  const s = String(v).trim();

  if(s.includes(',')){
    const temiz = s.replace(/\./g,'').replace(',','.');
    const n = parseFloat(temiz);
    return isNaN(n) ? 0 : n;
  }
  const tekNoktaOndalikMi = /^-?\d+\.\d{1,2}$/.test(s);
  if(tekNoktaOndalikMi){
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  const temiz = s.replace(/\./g,'');
  const n = parseFloat(temiz);
  return isNaN(n) ? 0 : n;
}

function fmtTL(n){
  const v = Number(n)||0;
  return v.toLocaleString('tr-TR',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₺';
}

function fmtInt(n){
  return (Number(n)||0).toLocaleString('tr-TR');
}

function excelDateToJS(v){
  if(v==null || v==='') return null;
  if(v instanceof Date) return v;
  if(typeof v==='number'){

    return new Date(Math.round((v - 25569) * 86400 * 1000));
  }
  const s = String(v).trim();

  if(/^\d{8}$/.test(s)){
    return new Date(Number(s.slice(0,4)), Number(s.slice(4,6))-1, Number(s.slice(6,8)));
  }

  const ggaayyyy = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
  if(ggaayyyy){
    const gun = Number(ggaayyyy[1]), ay = Number(ggaayyyy[2]), yil = Number(ggaayyyy[3]);
    return new Date(yil, ay-1, gun);
  }
  // YYYY-AA-GG (ISO tarih) — kaynak dosyalar bazen bu formatta metin verebilir; ay/gün
  // sırası belirsiz DEĞİL, o yüzden güvenle ayrıştırılır.
  const isoTarih = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if(isoTarih){
    const yil = Number(isoTarih[1]), ay = Number(isoTarih[2]), gun = Number(isoTarih[3]);
    return new Date(yil, ay-1, gun);
  }
  // GÜVENLİK: Buraya kadar bilinen hiçbir formata uymadıysa, ham `new Date(s)` KULLANMIYORUZ.
  // Örn. "01/02/2026" gibi metinlerde tarayıcı ay/gün sırasını kendi yerel ayarına göre
  // (çoğunlukla AA/GG olarak) yorumlar ve yanlış tarih üretir — bu da sessizce hatalı
  // "faturaTarihi" demektir. Belirsiz/tanınmayan format artık null döner (tabloda "—").
  return null;
}

const IDB_NAME = 'efaturaPanelDB';
const IDB_STORE = 'kv';
let idbPromise = null;

function idbAc(){
  if(idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject)=>{
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(IDB_STORE); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  return idbPromise;
}

async function idbSet(key, value){
  const db = await idbAc();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

async function idbGet(key){
  const db = await idbAc();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = ()=> resolve(req.result==null ? null : req.result);
    req.onerror = ()=> reject(req.error);
  });
}

function depolamaUyarisiGoster(mesaj){
  try{
    let el = document.getElementById('storageWarnBanner');
    if(!el){
      el = document.createElement('div');
      el.id = 'storageWarnBanner';
      el.className = 'storage-warn-banner';
      document.body.prepend(el);
    }
    el.innerHTML = `<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> ${mesaj}`;
    el.style.display = 'flex';
  }catch(e){}
}

async function saveKaynaklarToStorage(){
  try{
    await idbSet(STORAGE_KEY, state.kaynaklar);
  }catch(e){
    console.warn('Kaynaklar kaydedilemedi (IndexedDB)', e);
    depolamaUyarisiGoster('Yüklenen dosyalar tarayıcıya kalıcı olarak kaydedilemiyor. Gizli sekme kullanıyor olabilirsiniz — sayfayı kapatırsanız veriler kaybolabilir.');
  }
}

async function loadKaynaklarFromStorage(){
  try{
    const parsed = await idbGet(STORAGE_KEY);
    if(!parsed) return;
    Object.assign(state.kaynaklar, parsed);

  }catch(e){
    console.warn('Kaynaklar okunamadı (IndexedDB)', e);
    depolamaUyarisiGoster('Daha önce kaydedilmiş veriler okunamadı. Tarayıcı depolama ayarlarınızı kontrol edin.');
  }
}

async function saveManuelToStorage(){
  try{
    await idbSet(MANUEL_STORAGE_KEY, state.manuel);
  }catch(e){
    console.warn('Manuel işaretlemeler kaydedilemedi (IndexedDB)', e);
    depolamaUyarisiGoster('Manuel durum/not değişiklikleri kalıcı olarak kaydedilemiyor. Tarayıcı depolama ayarlarınızı kontrol edin.');
  }
}

async function loadManuelFromStorage(){
  try{
    const parsed = await idbGet(MANUEL_STORAGE_KEY);
    if(parsed) state.manuel = parsed;
  }catch(e){ console.warn('Manuel işaretlemeler okunamadı (IndexedDB)', e); }
}

async function saveTutarToleransToStorage(deger){
  try{ await idbSet(TUTAR_TOLERANS_STORAGE_KEY, deger); }
  catch(e){ console.warn('Tolerans ayarı kaydedilemedi (IndexedDB)', e); }
}

async function loadTutarToleransFromStorage(){
  try{
    const parsed = await idbGet(TUTAR_TOLERANS_STORAGE_KEY);
    return (typeof parsed==='number' && !isNaN(parsed)) ? parsed : null;
  }catch(e){ return null; }
}

const MANUEL_DURUM_TANIM = [
  {key:'eslesti', label:'Eşleşti', icon:'fa-solid fa-circle-check', cls:'badge-success'},
  {key:'iade_kesilecek', label:'İade Faturası Kesilecek', icon:'fa-solid fa-rotate-left', cls:'badge-purple'},
];

function manuelDurumTanimBul(key){
  return MANUEL_DURUM_TANIM.find(d=> d.key===key) || null;
}

async function manuelKaydiGuncelle(faturaKey, {durum, not} = {}){
  const mevcut = state.manuel[faturaKey] || {};
  const yeni = {
    durum: durum !== undefined ? durum : (mevcut.durum || null),
    not: not !== undefined ? not : (mevcut.not || ''),
    notGuncellemeZamani: (not !== undefined && not !== mevcut.not) ? new Date().toISOString() : (mevcut.notGuncellemeZamani || null),
  };

  const bosMu = !yeni.durum && !(yeni.not && yeni.not.trim());
  if(bosMu){
    delete state.manuel[faturaKey];
  }else{
    state.manuel[faturaKey] = yeni;
  }
  await saveManuelToStorage();
}
