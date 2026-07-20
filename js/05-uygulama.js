'use strict';

// Sidebar veri kaynağı tanımları — gruplandırılmış (menü değil, canlı yükleme paneli).
const KAYNAK_TANIM = {
  earsiv: {grup:'Entegratör', ad:'E-Arşiv', ikon:'fa-solid fa-box-archive'},
  efaturaQnb: {grup:'Entegratör', ad:'E-Fatura · QNB', ikon:'fa-solid fa-file-invoice'},
  efaturaLogo: {grup:'Entegratör', ad:'E-Fatura · Logo', ikon:'fa-solid fa-file-invoice'},
  netsis: {grup:'Muhasebe', ad:'Netsis (genel karşılık)', ikon:'fa-solid fa-calculator'},
  musteriKesan: {grup:'Müşteri / Şube', ad:'Keşan Müşteri Master', ikon:'fa-solid fa-users'},
  musteriBayrampasa: {grup:'Müşteri / Şube', ad:'Bayrampaşa Müşteri Master', ikon:'fa-solid fa-users'},
  efesEkstre: {grup:'Müşteri / Şube', ad:'Efes Cari Ekstre', ikon:'fa-solid fa-file-lines'},
};

// Bir kaynak kartının (sidebar) HTML'i — yüklüyse yeşil tik + dosya adı/satır, değilse "+".
function uploadRowHtml(kaynakKey){
  const tanim = KAYNAK_TANIM[kaynakKey];
  const mevcut = state.kaynaklar[kaynakKey];
  const cokluDosyaMi = kaynakKey === 'earsiv';
  let durumText = 'Henüz dosya seçilmedi';
  if(mevcut){
    if(cokluDosyaMi && Array.isArray(mevcut.dosyaAdlari) && mevcut.dosyaAdlari.length > 1){
      durumText = `${mevcut.dosyaAdlari.length} dosya (${mevcut.rows.length} satır)`;
    }else{
      durumText = `${escapeHtml(mevcut.dosyaAdi)} · ${mevcut.rows.length} satır`;
    }
  }
  return `
    <label class="sb-dosya ${mevcut?'yuklu':''}">
      <input type="file" accept=".xlsx,.xls" data-kaynak="${kaynakKey}" ${cokluDosyaMi?'multiple':''} style="display:none;">
      <span class="sb-dosya-ic ${mevcut?'ok':'bos'}"><i class="${mevcut?'fa-solid fa-check':'fa-solid fa-plus'}" aria-hidden="true"></i></span>
      <span class="sb-dosya-txt">
        <span class="sb-dosya-ad">${escapeHtml(tanim.ad)}</span>
        <span class="sb-dosya-durum ${mevcut?'ok':''}">${durumText}</span>
      </span>
      ${mevcut? '<span class="sb-dosya-sag"><i class="fa-solid fa-arrow-rotate-right" aria-hidden="true"></i></span>' : ''}
    </label>
  `;
}

function renderUploadPanels(){
  const el = document.getElementById('uploadPanels');
  // Gruplara göre sırala: Entegratör → Muhasebe → Müşteri/Şube (KAYNAK_TANIM sırası korunur).
  const gruplar = [];
  Object.keys(KAYNAK_TANIM).forEach(k=>{
    const g = KAYNAK_TANIM[k].grup;
    let grup = gruplar.find(x=> x.ad===g);
    if(!grup){ grup = {ad:g, keys:[]}; gruplar.push(grup); }
    grup.keys.push(k);
  });

  el.innerHTML = gruplar.map(g=>`
    <div class="sb-grup-etiket">${escapeHtml(g.ad)}</div>
    ${g.keys.map(uploadRowHtml).join('')}
  `).join('');

  el.querySelectorAll('input[type="file"]').forEach(input=>{
    input.addEventListener('change', async (e)=>{
      const files = Array.from(e.target.files || []);
      if(!files.length) return;
      const kaynakKey = input.dataset.kaynak;
      try{
        if(files.length > 1){
          // Çoklu dosya (şu an yalnızca E-Arşiv için): her dosyayı sırayla oku ve
          // satırları tek bir kaynak altında birleştir. Dosya adları ayrıca saklanır
          // ki özet gösterimi ("N dosya (X satır)") ve olası ihtiyaç halinde
          // dosya bazlı ayrıştırma mümkün olsun.
          const tumSatirlar = [];
          const dosyaAdlari = [];
          for(const file of files){
            const rows = await dosyayiOku(file);
            tumSatirlar.push(...rows);
            dosyaAdlari.push(file.name);
          }
          state.kaynaklar[kaynakKey] = {
            rows: tumSatirlar,
            dosyaAdi: dosyaAdlari.join(', '),
            dosyaAdlari,
            yuklemeZamani: new Date().toISOString(),
          };
        }else{
          const rows = await dosyayiOku(files[0]);
          state.kaynaklar[kaynakKey] = {rows, dosyaAdi: files[0].name, dosyaAdlari:[files[0].name], yuklemeZamani: new Date().toISOString()};
        }
        await saveKaynaklarToStorage();
        renderUploadPanels();
        guncelleRaporOlusturButonu();
      }catch(err){
        alert('Dosya okunamadı: ' + err.message);
      }
    });
  });
}

function guncelleRaporOlusturButonu(){
  const btn = document.getElementById('btnBuildReport');
  const entegratorVarMi = state.kaynaklar.earsiv || state.kaynaklar.efaturaLogo || state.kaynaklar.efaturaQnb;
  btn.disabled = !(entegratorVarMi && state.kaynaklar.netsis);
}

// ===== Sidebar aç/kapat (hem masaüstü hem mobil) =====
// Durum, .layout üzerindeki "sb-kapali" sınıfı ile yönetilir.
// Masaüstü: "kapalı" durumu sidebar'ı GİZLEMEZ — dar bir İKON RAYINA (68px) daraltır; ray
// üzerindeki logoya/oka tıklanınca tam genişlikte (270px) panel olarak GENİŞLER.
// Mobil: dokunma hedefleri için ray anlamsız olduğundan panel tamamen kayan bir çekmece
// olarak açılır/kapanır ve açıkken yarı saydam bir overlay belirir.
// Masaüstü tercihi IndexedDB'de saklanır (mobilde her zaman kapalı/ray başlar).
const SIDEBAR_STORAGE_KEY = 'efaturaPanelSidebarKapali_v1';

function sidebarKapaliMi(){
  return document.querySelector('.layout').classList.contains('sb-kapali');
}
async function sidebarDurumKaydet(){
  // Sadece masaüstü tercihini sakla — mobil daima kapalı başlar, kaydetmek anlamsız.
  if(window.innerWidth > 960){
    try{ await idbSet(SIDEBAR_STORAGE_KEY, sidebarKapaliMi()); }catch(e){}
  }
}
function sidebarAc(){
  document.querySelector('.layout').classList.remove('sb-kapali');
  sidebarDurumKaydet();
}
function sidebarKapat(){
  document.querySelector('.layout').classList.add('sb-kapali');
  sidebarDurumKaydet();
}
function sidebarAcKapaTogla(){
  if(sidebarKapaliMi()) sidebarAc(); else sidebarKapat();
}

function tarihAraligi(rows, tarihAlan){
  let min=null, max=null;
  rows.forEach(r=>{
    const t = r[tarihAlan];
    if(!t) return;
    if(!min || t<min) min=t;
    if(!max || t>max) max=t;
  });
  return {min, max};
}

function tarihUyusmazlikUyarisiVarMi(){
  const k = state.kaynaklar;
  if(!k.netsis) return null;
  const netsisAralik = tarihAraligi(k.netsis.rows, 'Tarih');
  const entegratorRowSets = [];
  if(k.efaturaLogo) entegratorRowSets.push(tarihAraligi(k.efaturaLogo.rows, 'Fatura Tarihi'));
  if(k.efaturaQnb) entegratorRowSets.push(tarihAraligi(k.efaturaQnb.rows, 'FATURA TARİHİ'));
  if(k.earsiv) entegratorRowSets.push(tarihAraligi(k.earsiv.rows, 'Oluşturma Tarihi'));
  if(!netsisAralik.min || !entegratorRowSets.length) return null;

  const entMin = entegratorRowSets.reduce((a,r)=> (!a||(r.min&&r.min<a))?r.min:a, null);
  const entMax = entegratorRowSets.reduce((a,r)=> (!a||(r.max&&r.max>a))?r.max:a, null);
  if(!entMin || !entMax) return null;
  const netsisGunSayisi = (netsisAralik.max - netsisAralik.min) / 86400000;
  const entGunSayisi = (entMax - entMin) / 86400000;
  if(netsisGunSayisi > entGunSayisi + 5 && netsisGunSayisi > 10){
    return `Netsis dosyası (${netsisAralik.min.toLocaleDateString('tr-TR')} – ${netsisAralik.max.toLocaleDateString('tr-TR')}) çok daha geniş bir tarih aralığı kapsıyor, entegratör dosyaları (${entMin.toLocaleDateString('tr-TR')} – ${entMax.toLocaleDateString('tr-TR')}) daha dar. Aynı döneme ait dosyaları yüklediğinizden emin olun — aksi halde "Entegratörde bulunamadı" sayısı yanıltıcı yüksek çıkar.`;
  }
  return null;
}

const RAPOR_STORAGE_KEY = 'efaturaPanelSonRapor_v1';

async function saveRaporToStorage(){
  try{
    await syncYaz(RAPOR_STORAGE_KEY, {
      rapor: state.rapor,
      kayitZamani: new Date().toISOString(),
      dosyaAdlari: Object.fromEntries(
        Object.entries(state.kaynaklar).map(([k,v])=>[k, v?v.dosyaAdi:null])
      ),
    });
  }catch(e){
    console.warn('Rapor kaydedilemedi:', e);
  }
}

async function loadRaporFromStorage(){
  try{
    const parsed = await syncOku(RAPOR_STORAGE_KEY, null);
    return parsed || null;
  }catch(e){
    console.warn('Kayıtlı rapor okunamadı:', e);
    return null;
  }
}

async function raporuOlustur(){
  try{
    state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari);
  }catch(err){
    console.error('Rapor oluşturulurken hata:', err);
    alert('Rapor oluşturulamadı: ' + err.message + '\n\nLütfen yüklenen dosyaların doğru formatta olduğundan emin olun.');
    return;
  }

  // Manuel "eslesti" işareti normalleşmesi: fatura o an Netsis'te bulunamadığı için elle
  // "Eşleşti" işaretlenmişti, ama yeni yüklenen Netsis verisinde ARTIK GERÇEKTEN bulunuyorsa
  // manuel etiketi taşımanın anlamı kalmaz — kalıcı olarak (state.manuel) normalleştirilir.
  // Not varsa KORUNUR, sadece durum alanı temizlenir (iade_kesilecek buna dahil değildir).
  const normallesenSayisi = (state.rapor.normallesenManuelIsaretler||[]).length;
  if(normallesenSayisi > 0){
    for(const faturaKey of state.rapor.normallesenManuelIsaretler){
      await manuelKaydiGuncelle(faturaKey, {durum: null});
    }
    // Manuel kayıtlar değiştiği için raporu bu güncel state.manuel ile yeniden hesapla —
    // aksi halde ekranda hâlâ "(Manuel)" etiketi görünmeye devam eder.
    state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari);
  }

  await saveRaporToStorage();

  // Ay sonu arşivi: bu raporun ait olduğu dönemi (ay-yıl) belirleyip arşive yaz/güncelle.
  // Geçmişe-eklenen-Netsis-kaydı kontrolü, arşivleme YAPILMADAN ÖNCEKİ arşiv durumuna göre
  // hesaplanmalı — yoksa "şimdiki dönem" az önce arşivlendiği için kendi kendini karşılaştırır.
  state.gecmiseEklenenNetsisKayitlari = gecmiseEklenenNetsisKayitlariBul(state.rapor);
  state.goruntulenenDonemId = null; // yeni rapor her zaman "canlı" (arşiv değil) görünümdür
  await donemiArsivle(state.rapor);

  const topbarSub = document.getElementById('topbarSub');
  const simdi = new Date().toLocaleString('tr-TR');
  const uyari = tarihUyusmazlikUyarisiVarMi();
  const normallesenNotu = normallesenSayisi > 0 ? ` · ${normallesenSayisi} manuel işaret otomatik normalleşti` : '';
  topbarSub.textContent = uyari
    ? `⚠ ${uyari}`
    : `Son güncelleme: ${simdi} · ${state.rapor.faturalar.length} kayıt${normallesenNotu}`;
  renderKPIs();
  renderGroupTabs();
  renderGroupSections();
  renderDonemPaneli();
  renderGecmiseEklenenUyari();
  if(window.innerWidth <= 960) sidebarKapat(); // yalnızca mobilde rapor oluşturunca paneli kapat
}

function raporDisaAktar(){
  if(!state.rapor){
    alert('Dışa aktarılacak bir rapor yok. Önce soldaki panelden dosyaları yükleyip raporu oluşturun.');
    return;
  }
  const disaAktarilan = {
    tur: 'efaturaPaneliRaporu',
    surum: 2, // v2: manuel işaretler, ham kaynaklar ve tolerans da dahil edildi
    olusturmaZamani: new Date().toISOString(),
    rapor: state.rapor,
    // v2 eklentileri: içe aktardıktan sonra manuel işaret/not düzenlemenin ve yeniden
    // hesaplamanın (computeRapor) doğru çalışabilmesi için gereken tüm durum.
    manuel: state.manuel,
    kaynaklar: state.kaynaklar,
    tolerans: TUTAR_TOLERANS,
  };

  const blob = new Blob([JSON.stringify(disaAktarilan)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const tarihEtiketi = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `efatura-raporu-${tarihEtiketi}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function raporTarihleriDuzelt(rapor){
  const alanlar = ['faturaTarihi'];
  const hepsi = [...(rapor.faturalar||[])];
  hepsi.forEach(f=>{
    alanlar.forEach(a=>{
      if(f[a] && typeof f[a]==='string'){
        const d = new Date(f[a]);
        if(!isNaN(d)) f[a] = d;
      }
    });
  });
  return rapor;
}

// İçe aktarılan ham kaynak satırlarındaki tarih değerleri, dışa aktarımda JSON.stringify
// ile ISO string'e dönüşmüş olabilir. computeRapor içindeki parse* fonksiyonları bu ham
// satırları yeniden excelDateToJS'ten geçirdiği için string tarihler zaten doğru çevrilir
// (excelDateToJS ISO ve GG.AA.YYYY string'lerini tanır). Bu fonksiyon şimdilik kaynakları
// olduğu gibi döndürür — ileride kaynak-özel bir dönüşüm gerekirse tek nokta burasıdır.
function kaynaklarTarihleriDuzelt(kaynaklar){
  return kaynaklar;
}

function raporEksikAlanlariTamamla(rapor){
  (rapor.faturalar||[]).forEach(f=>{
    if(!f.faturaKey) f.faturaKey = matchKey(f.vkn, f.faturaNo);
    if(f.manuelDurum === undefined) f.manuelDurum = null;
    if(f.not === undefined) f.not = '';
  });
  return rapor;
}

function raporIceAktar(file){
  const reader = new FileReader();
  reader.onload = (e)=>{
    let parsed;
    try{
      parsed = JSON.parse(e.target.result);
    }catch(err){
      alert('Dosya okunamadı: geçerli bir rapor dosyası değil.');
      return;
    }
    if(!parsed || parsed.tur!=='efaturaPaneliRaporu' || !parsed.rapor){
      alert('Bu dosya bir E-Fatura Mutabakat Paneli rapor dosyası değil.');
      return;
    }
    state.rapor = raporEksikAlanlariTamamla(raporTarihleriDuzelt(parsed.rapor));

    // v2 dosyalarında manuel işaretler + ham kaynaklar + tolerans da gömülüdür — bunları
    // geri yüklemek, içe aktarılan raporda da manuel düzenleme/yeniden hesaplama yapılınca
    // (faturaDetayKaydet → computeRapor) verinin bozulmasını önler. v1 dosyalarında bu
    // alanlar yoktur; o durumda mevcut state korunur (geriye dönük uyumluluk).
    if(parsed.manuel && typeof parsed.manuel==='object') state.manuel = parsed.manuel;
    if(parsed.kaynaklar && typeof parsed.kaynaklar==='object'){
      state.kaynaklar = kaynaklarTarihleriDuzelt(parsed.kaynaklar);
      saveKaynaklarToStorage();
      saveManuelToStorage();
      renderUploadPanels();
      guncelleRaporOlusturButonu();
    }
    if(typeof parsed.tolerans==='number' && !isNaN(parsed.tolerans)){
      tutarToleransiAyarla(parsed.tolerans);
      saveTutarToleransToStorage(TUTAR_TOLERANS);
      const ti = document.getElementById('toleransInput');
      if(ti) ti.value = TUTAR_TOLERANS;
    }

    saveRaporToStorage();
    const topbarSub = document.getElementById('topbarSub');
    const yuklemeZamani = parsed.olusturmaZamani ? new Date(parsed.olusturmaZamani).toLocaleString('tr-TR') : '—';
    topbarSub.textContent = `İçe aktarılan rapor · Oluşturma: ${yuklemeZamani} · ${state.rapor.faturalar.length} kayıt`;
    aktifGrup='tumu'; aktifDurum='tumu'; aktifKaynak='tumu'; aramaMetni=''; sayfayiSifirla();
    renderKPIs();
    renderGroupTabs();
    renderGroupSections();
  };
  reader.onerror = ()=> alert('Dosya okunamadı.');
  reader.readAsText(file);
}

// Tüm kalıcı veriyi (kaynaklar, manuel işaretler, dönem arşivi, şube atamaları,
// tolerans, rapor) senkron katmanı üzerinden yeniden okuyup ekranı günceller.
// initApp'te bir kere, erişim anahtarı ilk kez doğru girildiğinde bir kere daha
// (09-firebase.js) çağrılır — böylece anahtar girilir girilmez Firestore'daki
// güncel veriler hemen ekrana yansır.
async function tumVeriyiYenidenYukleVeCiz(){
  await loadKaynaklarFromStorage();
  await loadManuelFromStorage();
  await donemleriYukle();
  await subeAtamalariniYukle();
  const kayitliTolerans = await loadTutarToleransFromStorage();
  if(kayitliTolerans != null) tutarToleransiAyarla(kayitliTolerans);
  renderUploadPanels();
  guncelleRaporOlusturButonu();

  const kayitliRapor = await loadRaporFromStorage();
  const topbarSub = document.getElementById('topbarSub');
  if(kayitliRapor && kayitliRapor.rapor){
    state.rapor = raporEksikAlanlariTamamla(kayitliRapor.rapor);
    const zaman = new Date(kayitliRapor.kayitZamani).toLocaleString('tr-TR');
    topbarSub.textContent = `Kayıtlı rapor · Son oluşturma: ${zaman} · ${state.rapor.faturalar.length} kayıt`;
    state.gecmiseEklenenNetsisKayitlari = gecmiseEklenenNetsisKayitlariBul(state.rapor);
  }
  renderKPIs();
  renderGroupTabs();
  renderGroupSections();
  renderDonemPaneli();
  renderGecmiseEklenenUyari();
}

async function initApp(){
  fnoKopyalaDelegationBagla();

  // Sidebar başlangıç durumu: mobilde daima kapalı (kayan panel gizli);
  // masaüstünde kayıtlı tercih uygulanır — ilk ziyarette varsayılan olarak
  // dar İKON RAYI gösterilir (referans tasarımdaki gibi), kullanıcı genişletince tercih hatırlanır.
  const layoutEl = document.querySelector('.layout');
  if(window.innerWidth <= 960){
    layoutEl.classList.add('sb-kapali');
  }else{
    try{
      const k = await idbGet(SIDEBAR_STORAGE_KEY);
      if(k===false) layoutEl.classList.remove('sb-kapali');
      else layoutEl.classList.add('sb-kapali'); // varsayılan: ray (daraltılmış)
    }catch(e){
      layoutEl.classList.add('sb-kapali');
    }
  }

  // Firebase/erişim anahtarı kontrolü SESSİZCE dener — Firestore henüz yoksa veya
  // anahtar zaten localStorage'da kayıtlıysa hiçbir şey görünmez; sadece anahtar
  // hiç girilmemişse (ilk açılış) bir kere sorulur.
  if(typeof erisimKontroluBaslat === 'function') await erisimKontroluBaslat();

  await tumVeriyiYenidenYukleVeCiz();

  // Sidebar aç/kapat: masaüstünde ray üzerindeki logo/ok tıklanınca genişler/daralır
  // (rayın kendisi kaybolmaz); mobil hamburger tam paneli açar, X veya overlay kapatır.
  document.getElementById('btnSidebarToggleRail').addEventListener('click', sidebarAcKapaTogla);
  document.getElementById('btnSidebarDaralt').addEventListener('click', sidebarKapat);
  document.getElementById('btnSidebarAc').addEventListener('click', sidebarAc);
  document.getElementById('sbOverlay').addEventListener('click', sidebarKapat);

  document.getElementById('btnBuildReport').addEventListener('click', raporuOlustur);
  document.getElementById('btnRefreshArchive').addEventListener('click', ()=>{
    if(state.kaynaklar.earsiv || state.kaynaklar.efaturaLogo || state.kaynaklar.efaturaQnb){
      raporuOlustur();
    }
  });

  document.getElementById('btnRaporDisaAktar').addEventListener('click', raporDisaAktar);
  document.getElementById('btnRaporIceAktar').addEventListener('click', ()=>{
    document.getElementById('raporIceAktarInput').click();
  });
  document.getElementById('raporIceAktarInput').addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(file) raporIceAktar(file);
    e.target.value = '';
  });

  const toleransInput = document.getElementById('toleransInput');
  toleransInput.value = TUTAR_TOLERANS;
  toleransInput.addEventListener('change', async ()=>{
    tutarToleransiAyarla(toleransInput.value);
    toleransInput.value = TUTAR_TOLERANS;
    await saveTutarToleransToStorage(TUTAR_TOLERANS);
    if(state.rapor){
      state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari);
      await saveRaporToStorage();
      renderKPIs();
      renderGroupTabs();
      renderGroupSections();
    }
  });

  if((state.kaynaklar.earsiv || state.kaynaklar.efaturaLogo || state.kaynaklar.efaturaQnb) && state.kaynaklar.netsis){
    raporuOlustur();
  }
}

document.addEventListener('DOMContentLoaded', initApp);
