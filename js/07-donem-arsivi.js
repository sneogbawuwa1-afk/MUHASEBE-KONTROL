'use strict';

// ============================================================================
// DÖNEM ARŞİVİ — ay sonu genel muhasebe kontrolleri için:
//   1) Her rapor oluşturmada otomatik "dönem" (ay-yıl) arşivi tutulur.
//   2) Geçmiş dönemler ayrı ayrı (salt görüntüleme) tekrar açılabilir.
//   3) Son iki dönem karşılaştırılır (eşleşme oranı, kontrol grubu, fark tutarı vs.).
//   4) Ay içi gün bazlı kapsama boşlukları listelenir (entegratör/Netsis).
//   5) Yeni yüklenen Netsis verisinde, ARŞİVLENMİŞ bir geçmiş döneme ait olduğu
//      halde o dönem arşivlendiğinde orada olmayan kayıtlar → uyarı.
// Depolama: IndexedDB, anahtar: DONEM_STORAGE_KEY altında {donemId: donemKaydi} sözlüğü.
// ============================================================================

const DONEM_STORAGE_KEY = 'efaturaPanelDonemler_v1';

function donemIdUret(yil, ay){ // ay: 0-11 (JS Date ayı)
  return `${yil}-${String(ay+1).padStart(2,'0')}`;
}

function donemEtiketUret(donemId){
  if(!donemId) return '—';
  const [yil, ay] = donemId.split('-').map(Number);
  const AY_TAM_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  return `${AY_TAM_TR[ay-1]} ${yil}`;
}

// Rapordaki entegratör satırlarının tarihlerine bakıp en sık geçen ay-yılı döner —
// kullanıcının o an "hangi ayı çalıştığının" en güvenilir tahmini budur (dosya adı
// yerine veriye bakmak, yanlış isimlendirilmiş dosyalarda da doğru çalışır).
function raporunAitOlduguDonem(rapor){
  if(!rapor || !Array.isArray(rapor.faturalar)) return null;
  const sayac = new Map();
  rapor.faturalar.forEach(f=>{
    if(f.yon !== 'entegrator' || !f.faturaTarihi) return;
    const t = new Date(f.faturaTarihi);
    if(isNaN(t)) return;
    const id = donemIdUret(t.getFullYear(), t.getMonth());
    sayac.set(id, (sayac.get(id)||0) + 1);
  });
  if(!sayac.size) return null;
  let enCokId = null, enCokAdet = -1;
  sayac.forEach((adet, id)=>{ if(adet > enCokAdet){ enCokAdet = adet; enCokId = id; } });
  return enCokId;
}

// Netsis'te KARŞILIĞI OLAN (eşleşmiş veya sadece netsis'te bulunan) tüm satırların
// faturaKey kümesi — geçmişe-eklenen-kayıt kontrolünde "bu anahtar o dönem arşivinde
// var mıydı" sorusunu cevaplamak için kullanılır.
function netsisAnahtarKumesiCikar(rapor){
  const set = new Set();
  (rapor.faturalar||[]).forEach(f=>{
    if(f.netsisTutar!=null) set.add(f.faturaKey); // entegratör satırı ama Netsis'te eşleşme bulunmuş
    if(f.yon==='netsis') set.add(f.faturaKey); // sadece Netsis'te var, entegratörde yok
  });
  return set;
}

async function donemleriYukle(){
  try{
    const kayit = await idbGet(DONEM_STORAGE_KEY);
    state.donemler = kayit || {};
  }catch(e){
    console.warn('Dönem arşivi okunamadı (IndexedDB)', e);
    state.donemler = {};
  }
}

async function donemleriKaydet(){
  try{
    await idbSet(DONEM_STORAGE_KEY, state.donemler);
  }catch(e){
    console.warn('Dönem arşivi kaydedilemedi (IndexedDB)', e);
  }
}

// Ana giriş noktası: her raporuOlustur() sonrasında çağrılır. O anki raporu, ait
// olduğu döneme (ay-yıl) göre arşive yazar/günceller. Dönüş değeri: {donemId, oncekiDonemVarMi}
async function donemiArsivle(rapor){
  const donemId = raporunAitOlduguDonem(rapor);
  if(!donemId) return null;

  const kpi = rapor.kpi || {};
  const toplamTutar = (rapor.faturalar||[])
    .filter(f=> f.yon==='entegrator')
    .reduce((a,f)=> a + (f.tutar||0), 0);
  const toplamKdvEnt = (rapor.faturalar||[])
    .filter(f=> f.yon==='entegrator' && f.kdv!=null)
    .reduce((a,f)=> a + (f.kdv||0), 0);
  const toplamKdvNetsis = (rapor.faturalar||[])
    .filter(f=> f.netsisKdv!=null)
    .reduce((a,f)=> a + (f.netsisKdv||0), 0);
  const toplamTutarNetsis = (rapor.faturalar||[])
    .filter(f=> f.netsisTutar!=null)
    .reduce((a,f)=> a + (f.netsisTutar||0), 0);

  state.donemler[donemId] = {
    donemId,
    olusturmaZamani: new Date().toISOString(),
    rapor, // tam rapor saklanıyor ki geçmiş dönem tekrar açılıp tablo görüntülenebilsin
    netsisAnahtarlari: Array.from(netsisAnahtarKumesiCikar(rapor)),
    ozet: {
      toplam: kpi.toplam||0, eslesti: kpi.eslesti||0, islenmemis: kpi.islenmemis||0,
      entegratordeYok: kpi.entegratordeYok||0, fark: kpi.fark||0, red: kpi.red||0,
      kontrol: kpi.kontrol||0, toplamTutar, toplamTutarNetsis, toplamKdvEnt, toplamKdvNetsis,
    },
  };
  await donemleriKaydet();
  return {donemId};
}

function donemListesi(){ // en yeni → en eski sıralı
  return Object.keys(state.donemler).sort().reverse().map(id=> state.donemler[id]);
}

function oncekiDonemIdBul(donemId){
  const tumId = Object.keys(state.donemler).sort();
  const idx = tumId.indexOf(donemId);
  if(idx <= 0) return null;
  return tumId[idx-1];
}

// ===== 1) DÖNEMLER ARASI KARŞILAŞTIRMA =====
// Seçili dönem ile hemen önceki arşivlenmiş dönemin KPI farklarını döner. Yoksa null.
function donemKarsilastirmaHesapla(donemId){
  const simdi = state.donemler[donemId];
  if(!simdi) return null;
  const oncekiId = oncekiDonemIdBul(donemId);
  const onceki = oncekiId ? state.donemler[oncekiId] : null;
  if(!onceki) return {donemId, oncekiId:null, onceki:null, simdi: simdi.ozet, farklar:null};

  const alanlar = ['toplam','eslesti','islenmemis','entegratordeYok','fark','red','kontrol','toplamTutar','toplamKdvEnt'];
  const farklar = {};
  alanlar.forEach(a=>{
    const eski = onceki.ozet[a]||0, yeni = simdi.ozet[a]||0;
    farklar[a] = {eski, yeni, fark: yeni-eski, yuzdeFark: eski ? ((yeni-eski)/eski*100) : null};
  });
  const eskiEslesmeOrani = onceki.ozet.toplam ? (onceki.ozet.eslesti/onceki.ozet.toplam*100) : null;
  const yeniEslesmeOrani = simdi.ozet.toplam ? (simdi.ozet.eslesti/simdi.ozet.toplam*100) : null;

  return {
    donemId, oncekiId, onceki: onceki.ozet, simdi: simdi.ozet, farklar,
    eslesmeOraniFarki: (eskiEslesmeOrani!=null && yeniEslesmeOrani!=null) ? (yeniEslesmeOrani-eskiEslesmeOrani) : null,
    eskiEslesmeOrani, yeniEslesmeOrani,
  };
}

// ===== 2) GÜN BAZLI KAPSAMA BOŞLUĞU =====
// Seçili dönemin ayı içindeki her gün için: entegratörde fatura var mı, Netsis'te
// o güne ait kayıt var mı. Sadece "biri var biri yok" olan günleri döner (boşluklar).
function gunBazliBosluklariHesapla(donemId){
  const donem = state.donemler[donemId];
  if(!donem) return [];
  const [yil, ay] = donemId.split('-').map(Number);
  const ayIndex = ay-1;
  const sonGun = new Date(yil, ayIndex+1, 0).getDate();

  const entGunler = new Set();
  const netsisGunler = new Set();
  (donem.rapor.faturalar||[]).forEach(f=>{
    if(!f.faturaTarihi) return;
    const t = new Date(f.faturaTarihi);
    if(isNaN(t) || t.getFullYear()!==yil || t.getMonth()!==ayIndex) return;
    if(f.yon==='entegrator') entGunler.add(t.getDate());
    if(f.netsisTutar!=null || f.yon==='netsis') netsisGunler.add(t.getDate());
  });

  const bugun = new Date();
  const buAyMi = (bugun.getFullYear()===yil && bugun.getMonth()===ayIndex);
  const kontrolEdilecekSonGun = buAyMi ? Math.min(sonGun, bugun.getDate()-1) : sonGun; // bugünkü/eksik gün henüz kapanmamış sayılır

  const bosluklar = [];
  for(let g=1; g<=kontrolEdilecekSonGun; g++){
    const entVar = entGunler.has(g);
    const netsisVar = netsisGunler.has(g);
    if(entVar && !netsisVar){
      bosluklar.push({gun:g, tur:'netsis_eksik', aciklama:`${g} ${donemEtiketUret(donemId)}: entegratörde fatura var, Netsis'te bu güne ait hiç kayıt yok.`});
    }else if(!entVar && netsisVar){
      bosluklar.push({gun:g, tur:'entegrator_eksik', aciklama:`${g} ${donemEtiketUret(donemId)}: Netsis'te kayıt var, entegratörde bu güne ait hiç fatura yok.`});
    }
  }
  return bosluklar;
}

// ===== 3) DÖNEM BAZINDA KDV/TUTAR TOPLAM ÇAPRAZ KONTROLÜ =====
function donemToplamOzetiHesapla(donemId){
  const donem = state.donemler[donemId];
  if(!donem) return null;
  const o = donem.ozet;
  return {
    tutarFarki: (o.toplamTutar||0) - (o.toplamTutarNetsis||0),
    kdvFarki: (o.toplamKdvEnt||0) - (o.toplamKdvNetsis||0),
    toplamTutar: o.toplamTutar||0, toplamTutarNetsis: o.toplamTutarNetsis||0,
    toplamKdvEnt: o.toplamKdvEnt||0, toplamKdvNetsis: o.toplamKdvNetsis||0,
  };
}

// ===== 4) GEÇMİŞE EKLENEN NETSİS KAYDI UYARISI =====
// Yeni Netsis verisindeki her satır için: satırın tarihi ARŞİVLENMİŞ bir geçmiş
// döneme aitse VE o dönem arşivlendiğinde bu anahtar (VKN+belgeNo) orada yoksa,
// bu "sonradan eklenmiş/geriye dönük girilmiş" bir kayıt olabilir → uyarı listesine ekle.
// Not: yalnızca Netsis için çalışır (kullanıcı tercihi); şimdiki (canlı) dönem hariç tutulur.
function gecmiseEklenenNetsisKayitlariBul(rapor){
  if(!rapor) return [];
  const simdikiDonemId = raporunAitOlduguDonem(rapor);
  const arsivDonemIdleri = Object.keys(state.donemler).filter(id=> id !== simdikiDonemId);
  if(!arsivDonemIdleri.length) return [];

  const sonuc = [];
  (rapor.faturalar||[]).forEach(f=>{
    if(f.netsisTutar==null && f.yon!=='netsis') return; // sadece netsis kaynaklı/eşleşmiş satırlar
    if(!f.faturaTarihi) return;
    const t = new Date(f.faturaTarihi);
    if(isNaN(t)) return;
    const kayitDonemId = donemIdUret(t.getFullYear(), t.getMonth());
    if(kayitDonemId === simdikiDonemId) return; // bu ayın kendi verisi, sorun değil
    if(!state.donemler[kayitDonemId]) return; // o dönem hiç arşivlenmemiş, kıyaslanamaz

    const arsivlenmisAnahtarlar = new Set(state.donemler[kayitDonemId].netsisAnahtarlari || []);
    if(!arsivlenmisAnahtarlar.has(f.faturaKey)){
      sonuc.push({
        faturaKey: f.faturaKey, faturaNo: f.faturaNo, vkn: f.vkn, gonderenUnvan: f.gonderenUnvan,
        tutar: f.netsisTutar!=null ? f.netsisTutar : f.tutar, faturaTarihi: f.faturaTarihi,
        aitOlduguDonemId: kayitDonemId, aitOlduguDonemEtiket: donemEtiketUret(kayitDonemId),
      });
    }
  });
  return sonuc;
}
