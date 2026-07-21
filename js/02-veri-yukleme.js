'use strict';

function xlsxHazirMi(){
  return typeof window.XLSX !== 'undefined';
}

function dosyayiOku(file){
  return new Promise((resolve, reject)=>{
    if(!xlsxHazirMi()){ reject(new Error('XLSX kütüphanesi henüz yüklenmedi, birkaç saniye sonra tekrar deneyin.')); return; }
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const data = new Uint8Array(e.target.result);
        const wb = window.XLSX.read(data, {type:'array', cellDates:true});
        const ilkSayfa = wb.SheetNames[0];
        const sheet = wb.Sheets[ilkSayfa];
        const rows = window.XLSX.utils.sheet_to_json(sheet, {defval:null, raw:true});
        resolve(rows);
      }catch(err){ reject(err); }
    };
    reader.onerror = ()=> reject(new Error('Dosya okunamadı.'));
    reader.readAsArrayBuffer(file);
  });
}

function parseLogoRows(rows){
  return rows.map(r=>{
    const durum = String(r['Durum']||'').trim();
    const harici = String(r['Harici İptal Durumu']||'').trim();
    const redIptal = /RET|İPTAL|IPTAL|REJECT/i.test(durum) || Boolean(harici);
    return {
      vkn: r['Gönderici VKN'],
      faturaNo: r['Fatura No'],
      faturaTarihi: excelDateToJS(r['Fatura Tarihi']),
      tutar: toNumber(r['Toplam Tutar']),
      kdv: toNumber(r['KDV Toplamı']),
      gonderenUnvan: String(r['Gönderici Adı']||'').trim(),
      redIptal,
      kaynak: 'logo',
    };
  });
}

function parseQnbRows(rows){
  return rows.map(r=>{
    const durum = String(r['DURUM']||'').trim();
    const gibIptal = String(r['GIB PORTAL FATURA İPTAL DURUMU']||'').trim();
    const kepItiraz = String(r['KEP İTİRAZ DURUMU']||'').trim();
    const resmiItiraz = String(r['RESMİ YAZI İTİRAZ DURUMU']||'').trim();
    const redIptal = /RET|İPTAL|IPTAL|REJECT/i.test(durum) || Boolean(gibIptal) || Boolean(kepItiraz) || Boolean(resmiItiraz);
    return {
      vkn: r['GÖNDEREN VKN/TCKN'],
      faturaNo: r['FATURA NO'],
      faturaTarihi: excelDateToJS(r['FATURA TARİHİ']),
      tutar: toNumber(r['TUTAR']),
      kdv: null,
      gonderenUnvan: String(r['GÖNDEREN UNVAN/AD SOYAD']||'').trim(),
      redIptal,
      kaynak: 'qnb',
    };
  });
}

function parseEarsivRows(rows){
  return rows.map(r=>{
    const durum = String(r['İptal / İtiraz Durumu']||'').trim();
    const redIptal = Boolean(durum);

    const vkn = r['TCKN'] || r['VKN'];
    return {
      vkn,
      vknAdaylari: [r['TCKN'], r['VKN']].filter(v=> v!=null && v!==''),
      faturaNo: r['Fatura Numarası'],
      faturaTarihi: excelDateToJS(r['Oluşturma Tarihi']),
      tutar: toNumber(r['Ödenecek Tutar']),
      kdv: toNumber(r['Vergi Toplamı']),
      gonderenUnvan: String(r['Gönderici Unvan']||'').trim(),
      redIptal,
      kaynak: 'earsiv',
    };
  });
}

function parseNetsisRows(rows){
  return rows.map(r=>({
    vkn: r['VKN/TCKN'],
    belgeNo: r['Belge No'],
    tarih: excelDateToJS(r['Tarih']),
    cariIsim: String(r['Cari İsim']||'').trim(),
    cariKodu: String(r['Cari Kodu']||'').trim(),
    kdv: toNumber(r['KDV Toplamı']),
    tutar: toNumber(r['Genel Toplam']),
  }));
}

function parseMusteriMasterVknSeti(rows){
  const set = new Set();
  rows.forEach(r=>{
    const vn = normVKN(r['Vergi No']);
    const tc = normVKN(r['TC Kimlik No']);
    if(vn) set.add(vn);
    if(tc) set.add(tc);
  });
  return set;
}

// VKN(normalize) -> cari kodu eşleyen bir Map üretir. Keşan ve Bayrampaşa Müşteri
// Master dosyaları cari kodunu FARKLI sütunlarda taşıyor:
//   - Keşan Master     -> 'Müşteri' sütunu   (örn. "5000119479")
//   - Bayrampaşa Master -> 'Merkez Kodu' sütunu (örn. "2021624")
// Bu yüzden hangi sütunun okunacağı 'cariKoduSutunAdi' parametresiyle belirlenir.
// Aynı VKN'ye ait birden fazla satır (farklı mağaza/şube) varsa, İLK görülen kod
// kullanılır (Master dosyasındaki sıralama korunur — sonradan gelen tekrarlar yok sayılır).
function parseMusteriMasterCariKoduHaritasi(rows, cariKoduSutunAdi){
  const harita = new Map();
  rows.forEach(r=>{
    const vn = normVKN(r['Vergi No']);
    const tc = normVKN(r['TC Kimlik No']);
    const kod = String(r[cariKoduSutunAdi]==null ? '' : r[cariKoduSutunAdi]).trim();
    if(!kod) return;
    if(vn && !harita.has(vn)) harita.set(vn, kod);
    if(tc && !harita.has(tc)) harita.set(tc, kod);
  });
  return harita;
}

// Müşteri Master dosyasından VKN(normalize) -> cari kodu haritası üretir. Hangi sütunun
// cari kodu taşıdığı şubeye göre DEĞİŞİR — Keşan Master'da "Müşteri" sütunu (örn.
// "5000119479"), Bayrampaşa Master'da "Merkez Kodu" sütunu (örn. "2021624") kullanılır.
// cariKoduSutunAdi parametresiyle hangi sütunun okunacağı çağıran tarafından belirlenir.
// Aynı VKN altında birden fazla satır varsa (örn. aynı müşterinin farklı şubeleri) İLK
// dolu değeri kullanır — Master'daki satır sırası genelde tutarlıdır.
function parseMusteriMasterCariKoduHaritasi(rows, cariKoduSutunAdi){
  const harita = new Map();
  rows.forEach(r=>{
    const vn = normVKN(r['Vergi No']);
    const tc = normVKN(r['TC Kimlik No']);
    const kod = String(r[cariKoduSutunAdi]==null ? '' : r[cariKoduSutunAdi]).trim();
    if(!kod) return;
    if(vn && !harita.has(vn)) harita.set(vn, kod);
    if(tc && !harita.has(tc)) harita.set(tc, kod);
  });
  return harita;
}

const EFES_KESAN_ANAHTAR = '11859';
function efesEkstreKesanMi(rows){
  return rows.some(r=>{
    return Object.values(r).some(v=> String(v==null?'':v).includes(EFES_KESAN_ANAHTAR));
  });
}

function efesEkstreFaturaNoSeti(rows){
  const set = new Set();
  rows.forEach(r=>{
    const fn = r['Fatura No'];
    if(fn) set.add(String(fn).trim().toUpperCase());
  });
  return set;
}
