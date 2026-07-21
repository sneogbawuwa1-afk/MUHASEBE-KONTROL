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
    const kayit = await syncOku(DONEM_STORAGE_KEY, null);
    state.donemler = kayit || {};
  }catch(e){
    console.warn('Dönem arşivi okunamadı', e);
    state.donemler = {};
  }
}

async function donemleriKaydet(){
  try{
    await syncYaz(DONEM_STORAGE_KEY, state.donemler);
  }catch(e){
    console.warn('Dönem arşivi kaydedilemedi', e);
  }
}

// Bir dönem ID'sine ait olan satırları rapor içinden filtreler: entegratör satırları
// için faturaTarihi o aya denk gelenler + o entegratör satırlarının eşleştiği Netsis
// karşılıkları + sadece-Netsis'te-bulunan (yon:'netsis') satırlardan o aya ait olanlar.
function donemeAitSatirlariFiltrele(rapor, donemId){
  const [yil, ay] = donemId.split('-').map(Number);
  const ayIndex = ay-1;
  return (rapor.faturalar||[]).filter(f=>{
    if(!f.faturaTarihi) return false;
    const t = new Date(f.faturaTarihi);
    if(isNaN(t)) return false;
    return t.getFullYear()===yil && t.getMonth()===ayIndex;
  });
}

// Tek bir dönemi (donemId), rapor içindeki O DÖNEME AİT satırlarla arşive yazar/günceller.
// Önceki sürümden farkı: artık TÜM raporu değil, sadece ilgili döneme denk gelen
// satırları saklar — bu sayede çok-aylı bir Netsis dosyası doğru şekilde birden fazla
// döneme dağıtılabilir (bkz. donemleriTopluArsivle).
async function tekDonemiArsivle(rapor, donemId){
  const donemSatirlari = donemeAitSatirlariFiltrele(rapor, donemId);
  if(!donemSatirlari.length) return;

  const toplam = donemSatirlari.filter(f=> f.yon==='entegrator').length;
  const eslesti = donemSatirlari.filter(f=> f.durum==='eslesti').length;
  const islenmemis = donemSatirlari.filter(f=> f.durum==='islenmemis').length;
  const entegratordeYok = donemSatirlari.filter(f=> f.yon==='netsis').length;
  const fark = donemSatirlari.filter(f=> f.durum==='fark').length;
  const red = donemSatirlari.filter(f=> f.durum==='red').length;
  const kontrol = donemSatirlari.filter(f=> f.subeGrup==='kontrol').length;
  const toplamTutar = donemSatirlari.filter(f=> f.yon==='entegrator').reduce((a,f)=> a+(f.tutar||0), 0);
  const toplamKdvEnt = donemSatirlari.filter(f=> f.yon==='entegrator' && f.kdv!=null).reduce((a,f)=> a+(f.kdv||0), 0);
  const toplamKdvNetsis = donemSatirlari.filter(f=> f.netsisKdv!=null).reduce((a,f)=> a+(f.netsisKdv||0), 0);
  const toplamTutarNetsis = donemSatirlari.filter(f=> f.netsisTutar!=null).reduce((a,f)=> a+(f.netsisTutar||0), 0);

  state.donemler[donemId] = {
    donemId,
    olusturmaZamani: new Date().toISOString(),
    rapor: {faturalar: donemSatirlari, kpi: rapor.kpi, gruplar: rapor.gruplar, efesKesanMi: rapor.efesKesanMi},
    netsisAnahtarlari: Array.from(netsisAnahtarKumesiCikar({faturalar: donemSatirlari})),
    ozet: {toplam, eslesti, islenmemis, entegratordeYok, fark, red, kontrol, toplamTutar, toplamTutarNetsis, toplamKdvEnt, toplamKdvNetsis},
  };
}

// Ana giriş noktası: her raporuOlustur() sonrasında çağrılır. Raporun ait olduğu ana
// dönem (aktif çalışılan ay) HER ZAMAN arşivlenir/güncellenir — geriye dönük kontrol
// SADECE Netsis kaynaklı diğer (uzak/geçmiş) dönemler için uygulanır, bkz.
// donemGuncellemeAnaliziniYap ve donemleriTopluArsivle.
async function donemiArsivle(rapor){
  const donemId = raporunAitOlduguDonem(rapor);
  if(!donemId) return null;
  await tekDonemiArsivle(rapor, donemId);
  await donemleriKaydet();
  return {donemId};
}

// donemGuncellemeAnaliziniYap sonucuna göre: otomatikYazilacakDonemler listesindeki
// TÜM dönemleri arşive yazar (aktif dönem zaten donemiArsivle ile yazılmış olabilir,
// tekrar yazmak zararsızdır — idempotent). Tek bir syncYaz çağrısıyla kaydeder.
async function donemleriTopluArsivle(rapor, donemIdListesi){
  for(const donemId of donemIdListesi){
    await tekDonemiArsivle(rapor, donemId);
  }
  await donemleriKaydet();
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

// ===== 5) ÇOK-DÖNEMLİ NETSİS GÜNCELLEME ANALİZİ =====
// Kullanıcı kuralı: aktif çalışılan dönem (raporun ait olduğu ay) ve BİR SONRAKİ ay
// için Netsis değişiklikleri onaysız/otomatik arşive yazılır. Aktif dönemden ÖNCEKİ
// her ay (1 ay bile olsa) ve aktif dönemden 2+ ay SONRAKİ her ay için onay istenir.
// Bu, "ay sonu kapanmış dönemlere sessizce müdahale edilmesin" ilkesini uygular.

// donemId2 - donemId1 farkını AY SAYISI olarak döner (donemId2 daha ileri bir ay ise pozitif).
function donemFarkiAySayisi(donemId1, donemId2){
  const [y1, a1] = donemId1.split('-').map(Number);
  const [y2, a2] = donemId2.split('-').map(Number);
  return (y2 - y1) * 12 + (a2 - a1);
}

// aktifDonemId'ye göre hedefDonemId onaysız/otomatik yazılabilir mi?
// Kural: hedef == aktif (fark 0) VEYA hedef == aktif+1 ay (fark 1) → true (otomatik).
// Aktiften önce (fark < 0) veya aktiften 2+ ay sonra (fark >= 2) → false (onay gerekir).
function donemOtomatikYazilabilirMi(aktifDonemId, hedefDonemId){
  if(!aktifDonemId || !hedefDonemId) return true; // dönem belirlenemiyorsa eski davranış (engelleme yok)
  const fark = donemFarkiAySayisi(aktifDonemId, hedefDonemId);
  return fark === 0 || fark === 1;
}

// Rapordaki Netsis-kaynaklı (eşleşmiş veya sadece-Netsis'te) satırları, faturaTarihi'nin
// ait olduğu aya göre gruplar. Her grup: {donemId, satirlar:[...], anahtarlar:Set}
function netsisSatirlariniDonemeGoreGrupla(rapor){
  const gruplar = new Map(); // donemId -> {satirlar:[], anahtarlar:Set}
  (rapor.faturalar||[]).forEach(f=>{
    const netsisKaynakliMi = f.netsisTutar!=null || f.yon==='netsis';
    if(!netsisKaynakliMi || !f.faturaTarihi) return;
    const t = new Date(f.faturaTarihi);
    if(isNaN(t)) return;
    const donemId = donemIdUret(t.getFullYear(), t.getMonth());
    if(!gruplar.has(donemId)) gruplar.set(donemId, {donemId, satirlar:[], anahtarlar:new Set()});
    const grup = gruplar.get(donemId);
    grup.satirlar.push(f);
    grup.anahtarlar.add(f.faturaKey);
  });
  return gruplar;
}

// Ana analiz fonksiyonu: yeni oluşturulan raporu, ARŞİVLENMEMİŞ durumdaki mevcut
// state.donemler ile karşılaştırır (yani donemiArsivle ÇAĞRILMADAN ÖNCE kullanılmalı).
// Dönüş: {
//   otomatikYazilacakDonemler: [donemId, ...],      // aktif+1 ay içindekiler, direkt yazılır
//   onayBekleyenDonemler: [{
//     donemId, eskiSatirSayisi, yeniSatirSayisi,
//     yeniVeyaDegisenSatirlar: [...],   // dosyada var, arşivde yok/farklı -> otomatik eklenecek (kullanıcı onayına gerek yok, sadece bilgi)
//     eksikSatirlar: [...],             // arşivde var, dosyada yok -> kullanıcı karar vermeli (çıkar/kalsın)
//   }, ...]
// }
function donemGuncellemeAnaliziniYap(rapor){
  const aktifDonemId = raporunAitOlduguDonem(rapor);
  const yeniGruplar = netsisSatirlariniDonemeGoreGrupla(rapor);

  const otomatikYazilacakDonemler = [];
  const onayBekleyenDonemler = [];

  yeniGruplar.forEach((grup, donemId)=>{
    const arsivlenmisDonem = state.donemler[donemId] || null;
    const otomatikMi = donemOtomatikYazilabilirMi(aktifDonemId, donemId);

    if(otomatikMi || !arsivlenmisDonem){
      // Aktif/bir-sonraki-ay İSE otomatik; hiç arşivlenmemiş yeni bir dönemse de
      // karşılaştıracak bir şey yok, direkt yazılabilir (ilk kez arşivleniyor).
      otomatikYazilacakDonemler.push(donemId);
      return;
    }

    // Geçmiş/uzak bir dönem VE zaten arşivlenmiş: fark analizini yap.
    const eskiAnahtarlar = new Set(arsivlenmisDonem.netsisAnahtarlari || []);
    const yeniAnahtarlar = grup.anahtarlar;

    const yeniVeyaDegisenSatirlar = grup.satirlar.filter(f=> !eskiAnahtarlar.has(f.faturaKey));
    const eksikAnahtarlar = Array.from(eskiAnahtarlar).filter(k=> !yeniAnahtarlar.has(k));
    // Eksik anahtarların görüntülenebilir bilgisini eski arşivlenmiş rapordan çekiyoruz.
    const eskiSatirlarByKey = new Map(
      (arsivlenmisDonem.rapor && arsivlenmisDonem.rapor.faturalar || []).map(f=> [f.faturaKey, f])
    );
    const eksikSatirlar = eksikAnahtarlar
      .map(k=> eskiSatirlarByKey.get(k))
      .filter(Boolean);

    if(yeniVeyaDegisenSatirlar.length === 0 && eksikSatirlar.length === 0){
      return; // bu dönemde hiçbir fark yok, uğraşmaya gerek yok
    }

    onayBekleyenDonemler.push({
      donemId,
      donemEtiket: donemEtiketUret(donemId),
      eskiSatirSayisi: eskiAnahtarlar.size,
      yeniSatirSayisi: yeniAnahtarlar.size,
      yeniVeyaDegisenSatirlar,
      eksikSatirlar,
    });
  });

  return {aktifDonemId, otomatikYazilacakDonemler, onayBekleyenDonemler};
}

// Kullanıcı onay modalında "Tümünü Göz Ardı Et ve Uygula"ya bastıktan sonra çağrılır.
// onayBekleyenDonem: donemGuncellemeAnaliziniYap'ın onayBekleyenDonemler dizisinden bir eleman.
// cikarilacakFaturaKeyleri: kullanıcının "Elle çıkar" ile işaretlediği faturaKey'lerin Set'i
//   (bu anahtarlar arşivden SİLİNİR); işaretlenmeyen eksik satırlar arşivde OLDUĞU GİBİ KALIR.
// Yeni/değişen satırlar HER ZAMAN eklenir (bunlar için zaten onay istenmiyor, sadece bilgi amaçlıydı).
async function donemOnayiUygula(onayBekleyenDonem, cikarilacakFaturaKeyleri){
  const {donemId, yeniVeyaDegisenSatirlar, eksikSatirlar} = onayBekleyenDonem;
  const mevcutArsiv = state.donemler[donemId];
  if(!mevcutArsiv) return;

  const cikarilacaklar = cikarilacakFaturaKeyleri || new Set();
  // Korunacak eksik satırlar: kullanıcının işaretlemediği (yani "kalsın" dediği) satırlar.
  const korunacakEksikSatirlar = eksikSatirlar.filter(f=> !cikarilacaklar.has(f.faturaKey));

  // Yeni arşiv listesi = (eski arşivdeki satırlar İÇİNDEN çıkarılacaklar hariç tutulmuş hali)
  //                        zaten korunacakEksikSatirlar + yeni/değişen satırlar birebir bunu temsil
  //                        etmiyor çünkü eski arşivde "zaten aynı kalan" satırlar da vardı.
  // En doğru yöntem: eski arşivdeki TÜM satırlardan çıkarılacakları çıkarıp, üstüne yeni/
  // değişen satırları (varsa eskisinin yerine geçecek şekilde, faturaKey bazında) eklemek.
  const eskiSatirlar = (mevcutArsiv.rapor && mevcutArsiv.rapor.faturalar) || [];
  const yeniVeyaDegisenKeySeti = new Set(yeniVeyaDegisenSatirlar.map(f=> f.faturaKey));

  const guncelSatirlar = [
    ...eskiSatirlar.filter(f=> !cikarilacaklar.has(f.faturaKey) && !yeniVeyaDegisenKeySeti.has(f.faturaKey)),
    ...yeniVeyaDegisenSatirlar,
  ];

  const sahteRapor = {faturalar: guncelSatirlar, kpi: mevcutArsiv.rapor.kpi, gruplar: mevcutArsiv.rapor.gruplar, efesKesanMi: mevcutArsiv.rapor.efesKesanMi};
  await tekDonemiArsivle(sahteRapor, donemId);
  await donemleriKaydet();
}

