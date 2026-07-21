'use strict';

// ============================================================================
// NETSİS HAM VERİ BİRLEŞTİRME
//
// SORUN: Netsis dosyası her yüklendiğinde eski `state.kaynaklar.netsis.rows`
// TAMAMEN üzerine yazılıyordu — yani sadece Keşan'ın Netsis dökümünü yüklersen,
// önceden yüklü olan Bayrampaşa'nın (veya geçmiş ayların) tüm satırları SİLİNİYORDU.
// Önceden kurulan "geçmişe müdahale onayı" mekanizması (07-donem-arsivi.js) SADECE
// arşivlenmiş DÖNEM kayıtlarını koruyordu, ama canlı/güncel `state.kaynaklar.netsis.rows`
// hiç bu korumadan geçmiyordu — bu yüzden CANLI rapor (arşiv değil) hâlâ eksik/yanlış
// çıkıyordu.
//
// ÇÖZÜM: Netsis dosyası yüklendiğinde, ham satırlar direkt state'e yazılmaz — önce
// bu modüldeki netsisHamVeriyiBirlestir() ile MEVCUT ham satırlarla VKN+BelgeNo
// bazında birleştirilir:
//   - Aktif çalışılan ay + bir sonraki ay: yeni/değişen satırlar OTOMATİK işlenir.
//   - Diğer aylar (1 ay önce ve öncesi, veya 2+ ay ileri): fark varsa ONAY beklenir
//     (js/07-donem-arsivi.js'deki aynı donemOtomatikYazilabilirMi kuralı kullanılır).
//   - HER DURUMDA: yeni dosyada olmayan ama eski veride olan satırlar KORUNUR
//     (otomatik silinmez) — kullanıcı sadece "elle çıkar" derse silinir.
// ============================================================================

// Ham Netsis satırlarını (parseNetsisRows çıktısı DEĞİL, state.kaynaklar.netsis.rows
// içindeki HAM Excel satırları) VKN+BelgeNo bazında bir anahtara göre indeksler.
// Sütun adları parseNetsisRows ile aynı olmalı (bkz. js/02-veri-yukleme.js).
function netsisHamSatirAnahtarUret(hamSatir){
  return matchKey(hamSatir['VKN/TCKN'], hamSatir['Belge No']);
}

// Ham bir Netsis satırının hangi aya (donemId) ait olduğunu, 'Tarih' sütunundan bulur.
function netsisHamSatirDonemi(hamSatir){
  const t = excelDateToJS(hamSatir['Tarih']);
  if(!t || isNaN(t)) return null;
  return donemIdUret(t.getFullYear(), t.getMonth());
}

// Ana birleştirme fonksiyonu. eskiHamSatirlar/yeniHamSatirlar: state.kaynaklar.netsis.rows
// formatında ham Excel satırı dizileri. aktifDonemId: raporun o an ait olduğu ay (yeni
// dosya yüklenmeden ÖNCEKİ mevcut rapora göre) — yoksa null, bu durumda hepsi otomatik kabul edilir.
//
// Dönüş: {
//   birlesikSatirlar: [...],           // otomatik uygulanan hali (yeni state.kaynaklar.netsis.rows olacak)
//   onayBekleyenDonemler: [{
//     donemId, donemEtiket,
//     yeniVeyaDegisenSatirlar: [...],   // otomatik zaten dahil edildi, sadece bilgi amaçlı
//     eksikSatirlar: [...],             // eski veride var, yeni dosyada yok -> kullanıcı karar vermeli
//   }, ...]
// }
function netsisHamVeriyiBirlestir(eskiHamSatirlar, yeniHamSatirlar, aktifDonemId){
  eskiHamSatirlar = eskiHamSatirlar || [];
  yeniHamSatirlar = yeniHamSatirlar || [];

  // Eski satırları anahtar bazında indeksle.
  const eskiByAnahtar = new Map();
  eskiHamSatirlar.forEach(satir=>{
    eskiByAnahtar.set(netsisHamSatirAnahtarUret(satir), satir);
  });

  // Yeni satırları da anahtar bazında indeksle (aynı dosyada tekrar eden anahtar olursa sonuncusu kazanır).
  const yeniByAnahtar = new Map();
  yeniHamSatirlar.forEach(satir=>{
    yeniByAnahtar.set(netsisHamSatirAnahtarUret(satir), satir);
  });

  // Yeni satırları döneme göre grupla (hangi ayın verisi bu dosyada var).
  const yeniDonemGruplari = new Map(); // donemId -> Set<anahtar>
  yeniHamSatirlar.forEach(satir=>{
    const donemId = netsisHamSatirDonemi(satir);
    if(!donemId) return;
    if(!yeniDonemGruplari.has(donemId)) yeniDonemGruplari.set(donemId, new Set());
    yeniDonemGruplari.get(donemId).add(netsisHamSatirAnahtarUret(satir));
  });

  // Eski satırları da döneme göre grupla — "bu ayın eski verisi var mıydı" kontrolü için.
  const eskiDonemGruplari = new Map(); // donemId -> Set<anahtar>
  eskiHamSatirlar.forEach(satir=>{
    const donemId = netsisHamSatirDonemi(satir);
    if(!donemId) return;
    if(!eskiDonemGruplari.has(donemId)) eskiDonemGruplari.set(donemId, new Set());
    eskiDonemGruplari.get(donemId).add(netsisHamSatirAnahtarUret(satir));
  });

  const onayBekleyenDonemler = [];
  const onayliCikarilanAnahtarlar = new Set(); // onay bekleyen dönemlerdeki "eksik" anahtarlar (henüz karar verilmedi, geçici olarak KORUNUR)

  // Hangi dönemlerin yeni içeriği otomatik kabul edilebilir, hangileri onay bekler?
  const tumIlgiliDonemler = new Set([...yeniDonemGruplari.keys(), ...eskiDonemGruplari.keys()]);
  tumIlgiliDonemler.forEach(donemId=>{
    const otomatikMi = donemOtomatikYazilabilirMi(aktifDonemId, donemId);
    if(otomatikMi) return; // aktif ay + 1 ay: fark analizi gerekmez, direkt kabul

    const eskiAnahtarlar = eskiDonemGruplari.get(donemId) || new Set();
    const yeniAnahtarlar = yeniDonemGruplari.get(donemId) || new Set();

    const yeniVeyaDegisenAnahtarlar = Array.from(yeniAnahtarlar).filter(a=> !eskiAnahtarlar.has(a));
    const eksikAnahtarlar = Array.from(eskiAnahtarlar).filter(a=> !yeniAnahtarlar.has(a));

    if(yeniVeyaDegisenAnahtarlar.length===0 && eksikAnahtarlar.length===0) return; // bu ayda hiç fark yok

    onayBekleyenDonemler.push({
      donemId,
      donemEtiket: donemEtiketUret(donemId),
      yeniVeyaDegisenSatirlar: yeniVeyaDegisenAnahtarlar.map(a=> yeniByAnahtar.get(a)).filter(Boolean),
      eksikSatirlar: eksikAnahtarlar.map(a=> eskiByAnahtar.get(a)).filter(Boolean),
    });
  });

  // Otomatik birleştirme: eski satırlardan başlayıp, yeni satırlarla güncelliyoruz.
  // Yeni dosyada olmayan eski satırlar HER ZAMAN korunur (silinmez) — onay bekleyen
  // dönemlerdeki "eksik" satırlar da dahil (kullanıcı ayrıca "elle çıkar" demedikçe).
  const birlesikByAnahtar = new Map(eskiByAnahtar);
  yeniByAnahtar.forEach((satir, anahtar)=>{
    birlesikByAnahtar.set(anahtar, satir); // yeni/değişen satır eskisinin üzerine yazılır
  });

  return {
    birlesikSatirlar: Array.from(birlesikByAnahtar.values()),
    onayBekleyenDonemler,
  };
}

// Kullanıcı onay modalında karar verdikten sonra çağrılır: cikarilacakAnahtarlar
// (Set<anahtar>) işaretlenen eksik satırları state.kaynaklar.netsis.rows'tan siler.
function netsisOnayiUygula(mevcutHamSatirlar, cikarilacakAnahtarlar){
  if(!cikarilacakAnahtarlar || !cikarilacakAnahtarlar.size) return mevcutHamSatirlar;
  return mevcutHamSatirlar.filter(satir=> !cikarilacakAnahtarlar.has(netsisHamSatirAnahtarUret(satir)));
}
