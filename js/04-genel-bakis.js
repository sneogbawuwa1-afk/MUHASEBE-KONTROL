'use strict';

let aktifGrup = 'tumu';
let aktifDurum = 'tumu';
let aktifKaynak = 'tumu';
let aramaMetni = '';
let siralamaAlani = 'faturaTarihi';
let siralamaYonu = 'desc';
const SAYFA_ADIMI = 30;
let gosterilenSatirSayisi = SAYFA_ADIMI;
let aramaDebounceTimer = null; // ÖNERİ 7: arama kutusu debounce zamanlayıcısı

function sayfayiSifirla(){
  gosterilenSatirSayisi = SAYFA_ADIMI;
}

function durumBadgeClass(durum){
  switch(durum){
    case 'eslesti': return 'badge-success';
    case 'fark': return 'badge-purple';
    case 'islenmemis': return 'badge-danger';
    case 'entegratorde_yok': return 'badge-warn';
    case 'red': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

function durumBadgeIcon(durum){
  switch(durum){
    case 'eslesti': return 'fa-solid fa-circle-check';
    case 'fark': return 'fa-solid fa-scale-unbalanced';
    case 'islenmemis': return 'fa-solid fa-circle-exclamation';
    case 'entegratorde_yok': return 'fa-solid fa-plug-circle-xmark';
    case 'red': return 'fa-solid fa-ban';
    default: return 'fa-solid fa-circle';
  }
}

function aktifGrupSatirlariKaynaksiz(){
  if(!state.rapor) return [];
  const {faturalar, gruplar} = state.rapor;
  if(aktifGrup==='kesan') return gruplar.kesan;
  if(aktifGrup==='bayrampasa') return gruplar.bayrampasa;
  if(aktifGrup==='kontrol') return gruplar.kontrol;
  if(aktifGrup==='notlar') return gruplar.notlu;
  return faturalar;
}

function aktifGrupSatirlari(){
  return kaynagaGoreFiltrele(aktifGrupSatirlariKaynaksiz());
}

function kpiHesapla(satirlar){
  return {
    toplam: satirlar.filter(f=>f.yon==='entegrator').length,
    eslesti: satirlar.filter(f=>f.durum==='eslesti').length,
    islenmemis: satirlar.filter(f=>f.durum==='islenmemis').length,
    entegratordeYok: satirlar.filter(f=>f.durum==='entegratorde_yok').length,
    fark: satirlar.filter(f=>f.durum==='fark').length,
    red: satirlar.filter(f=>f.durum==='red').length,
  };
}

const KPI_TANIM = [
  {key:'toplam', label:'TOPLAM FATURA', cls:'c-blue', durum:'tumu', icon:'fa-regular fa-file-lines', sub:'Entegratör kayıtları'},
  {key:'eslesti', label:'EŞLEŞTİ', cls:'c-green', durum:'eslesti', icon:'fa-solid fa-circle-check', sub:'eşleşme oranı'},
  {key:'islenmemis', label:"NETSİS'TE BULUNAMADI", cls:'c-red', durum:'islenmemis', icon:'fa-solid fa-triangle-exclamation', sub:'işlenmemiş'},
  {key:'entegratordeYok', label:'ENTEGRATÖRDE BULUNAMADI', cls:'c-orange', durum:'entegratorde_yok', icon:'fa-solid fa-plug-circle-xmark', sub:"Sadece Netsis'te var"},
  {key:'fark', label:'TUTAR/KDV FARKI', cls:'c-purple', durum:'fark', icon:'fa-solid fa-scale-unbalanced', sub:'farklı kayıt'},
  {key:'red', label:'REDDEDİLDİ/İPTAL', cls:'c-cyan', durum:'red', icon:'fa-solid fa-ban', sub:'ret / iptal'},
];

function yuzdeStr(pay, payda){
  if(!payda) return '';
  return '%' + (pay*100/payda).toFixed(1).replace('.', ',');
}

// Bir satırın "gösterilen" tutarı: netsis kaynaklı satırlarda netsisTutar, aksi halde tutar.
function satirTutari(f){
  return f.yon==='netsis' ? (f.netsisTutar||0) : (f.tutar||0);
}

// ÖNERİ 3: Tutarsal özet — seçili gruptaki satırlar için problem kategorilerinin TOPLAM
// TL değerini hesaplar. "fark" kategorisi net kâr/zarar DEĞİL, mutlak sapma toplamıdır
// (her fark düzeltilmesi gereken bir uyumsuzluktur — kullanıcı onaylı anlayış).
function tutarOzetiHesapla(satirlar){
  const eslesenToplam = satirlar.filter(f=>f.durum==='eslesti').reduce((a,f)=> a+satirTutari(f), 0);
  const netsisteYokToplam = satirlar.filter(f=>f.durum==='islenmemis').reduce((a,f)=> a+satirTutari(f), 0);
  const entegratordeYokToplam = satirlar.filter(f=>f.durum==='entegratorde_yok').reduce((a,f)=> a+satirTutari(f), 0);
  const farkSatirlari = satirlar.filter(f=>f.durum==='fark' && f.farkDetay);
  const toplamSapma = farkSatirlari.reduce((a,f)=> a+Math.abs(f.farkDetay.tutarFarkTutari||0), 0);
  return {eslesenToplam, netsisteYokToplam, entegratordeYokToplam, toplamSapma, farkAdet: farkSatirlari.length};
}

// Dekoratif sparkline (sabit şekil) — kart kimliğini zenginleştirmek için; gerçek zaman
// serisi verisi TAŞIMAZ (geçmiş rapor karşılaştırması henüz yok). Renk karta göre gelir.
function sparklineHtml(renk, path){
  return `<svg class="ozet-spark" width="56" height="26" viewBox="0 0 56 26" aria-hidden="true"><path d="${path}" fill="none" stroke="${renk}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function renderTutarOzeti(){
  const el = document.getElementById('tutarOzetKap');
  if(!el) return;
  if(!state.rapor){ el.innerHTML = ''; return; }
  // notlar grubunda tutar özeti anlamlı değil (karışık durumlarda faturalar var) — gizle.
  if(aktifGrup==='notlar'){ el.innerHTML = ''; return; }
  const satirlar = aktifGrupSatirlari();
  const o = tutarOzetiHesapla(satirlar);
  const kart = (cls, ikon, lbl, tutar, altMetin, sparkRenk, sparkPath)=>`
    <div class="ozet-card ${cls}">
      <div class="ozet-sol">
        <div class="ozet-lbl"><i class="${ikon}" aria-hidden="true"></i> ${lbl}</div>
        <div class="ozet-tutar">${fmtTL(tutar)}</div>
        <div class="ozet-adet">${altMetin}</div>
      </div>
      ${sparklineHtml(sparkRenk, sparkPath)}
    </div>
  `;
  el.innerHTML = `
    <div class="tutar-ozet-grid">
      ${kart('c1','fa-solid fa-triangle-exclamation',"Netsis'te Yok", o.netsisteYokToplam, 'toplam tutar', '#E23E3E', 'M2 8 L12 14 L22 10 L32 18 L42 15 L54 23')}
      ${kart('c2','fa-solid fa-plug-circle-xmark','Entegratörde Yok', o.entegratordeYokToplam, 'toplam tutar', '#F08A1D', 'M2 14 L12 10 L22 16 L32 12 L42 19 L54 16')}
      ${kart('c3','fa-solid fa-scale-unbalanced','Tutmayan Tutar', o.toplamSapma, `${fmtInt(o.farkAdet)} faturada uyumsuzluk`, '#7C5CFC', 'M2 13 L11 9 L20 16 L29 11 L38 17 L47 12 L54 14')}
      ${kart('c4','fa-solid fa-circle-check','Eşleşen Toplam', o.eslesenToplam, 'toplam tutar', '#18A45B', 'M2 21 L14 17 L26 18 L38 10 L48 8 L54 3')}
    </div>
  `;
}

// ÖNERİ 2: Yeni raporda karşılığı bulunamayan manuel işaret/notlar için uyarı şeridi.
function renderYetimUyari(){
  const el = document.getElementById('yetimUyariKap');
  if(!el) return;
  const yetim = state.rapor && state.rapor.yetimManuel ? state.rapor.yetimManuel : [];
  if(!yetim.length){ el.innerHTML = ''; return; }
  const notluAdet = yetim.filter(y=> y.not && y.not.trim()).length;
  const detaySatirlari = yetim.slice(0, 30).map(y=>{
    const durumTanim = y.durum ? manuelDurumTanimBul(y.durum) : null;
    const etiket = durumTanim ? durumTanim.label : (y.not ? 'Not' : '—');
    return `<div class="yetim-satir"><span class="yetim-etiket">${escapeHtml(etiket)}</span>${y.not ? `<span class="yetim-not">${escapeHtml(y.not)}</span>` : ''}</div>`;
  }).join('');
  el.innerHTML = `
    <div class="yetim-uyari">
      <div class="yetim-uyari-ust">
        <div class="yetim-uyari-baslik">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <span><strong>${fmtInt(yetim.length)}</strong> manuel işaret/not bu raporda eşleşmedi${notluAdet? ` (${fmtInt(notluAdet)} tanesinde not var)` : ''}.</span>
        </div>
        <button type="button" class="yetim-detay-btn" id="btnYetimDetay">Detayları göster <i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
      </div>
      <div class="yetim-detay" id="yetimDetay" hidden>
        <div class="yetim-aciklama">Bu işaretler, daha önce başka bir fatura no/VKN'ye eklenmişti; yeni yüklenen veride o kayıtların karşılığı bulunamadı. Verilerin doğru dönemde olduğundan emin olun — işaretler silinmez, kayıtlar geri gelirse yeniden eşleşir.</div>
        ${detaySatirlari}
        ${yetim.length>30? `<div class="yetim-satir" style="color:var(--ink-faint);">…ve ${fmtInt(yetim.length-30)} tane daha</div>` : ''}
      </div>
    </div>
  `;
  const btn = document.getElementById('btnYetimDetay');
  const det = document.getElementById('yetimDetay');
  if(btn && det){
    btn.addEventListener('click', ()=>{
      const acik = !det.hidden;
      det.hidden = acik;
      btn.innerHTML = acik ? 'Detayları göster <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>' : 'Gizle <i class="fa-solid fa-chevron-up" aria-hidden="true"></i>';
    });
  }
}

// ===== AY SONU KONTROLÜ 1: Geçmiş/uzak dönem Netsis değişikliği onay modalı =====
// Aktif çalışılan ay (ve bir sonraki ay) DIŞINDA kalan dönemlere ait Netsis
// değişiklikleri otomatik arşivlenmez — bu modal kullanıcıya ne değiştiğini gösterir:
//   - "Yeni/değişen" satırlar: dosyada var, arşivde yok/farklıydı → otomatik eklenecek (bilgi amaçlı)
//   - "Eksik" satırlar: arşivde var, yeni dosyada yok → kullanıcı "Elle çıkar" ile işaretleyebilir
// "Tümünü Göz Ardı Et ve Uygula": işaretlenen eksikler arşivden silinir, işaretlenmeyenler
// (ve tüm yeni/değişen satırlar) arşive yazılır.
function donemOnayModaliAc(onayBekleyenDonemler){
  if(!onayBekleyenDonemler || !onayBekleyenDonemler.length) return;
  if(document.getElementById('donemOnayOverlay')) return; // zaten açık, tekrar açma

  const donemBlokHtml = (d, dIndex)=>{
    const yeniSatirlarHtml = d.yeniVeyaDegisenSatirlar.slice(0, 30).map(f=>`
      <div class="donem-onay-satir">
        <span class="donem-onay-fno">${escapeHtml(f.faturaNo||'')}</span>
        <span class="donem-onay-unvan">${escapeHtml(f.gonderenUnvan||'')}</span>
        <span class="donem-onay-tutar">${fmtTL(f.netsisTutar!=null?f.netsisTutar:f.tutar)}</span>
      </div>
    `).join('');

    const eksikSatirlarHtml = d.eksikSatirlar.slice(0, 60).map((f, fIndex)=>`
      <label class="donem-onay-eksik-satir">
        <input type="checkbox" class="donem-onay-cikar-cb" data-donem-index="${dIndex}" data-fatura-key="${escapeHtml(f.faturaKey)}">
        <span class="donem-onay-fno">${escapeHtml(f.faturaNo||'')}</span>
        <span class="donem-onay-unvan">${escapeHtml(f.gonderenUnvan||'')}</span>
        <span class="donem-onay-tutar">${fmtTL(f.netsisTutar!=null?f.netsisTutar:f.tutar)}</span>
      </label>
    `).join('');

    return `
      <div class="donem-onay-blok">
        <div class="donem-onay-blok-baslik"><i class="fa-solid fa-calendar-week" aria-hidden="true"></i> ${escapeHtml(d.donemEtiket)}</div>

        ${d.yeniVeyaDegisenSatirlar.length ? `
          <div class="donem-onay-alt-baslik ok">${fmtInt(d.yeniVeyaDegisenSatirlar.length)} yeni/değişen kayıt — otomatik eklenecek</div>
          <div class="donem-onay-liste">${yeniSatirlarHtml}</div>
          ${d.yeniVeyaDegisenSatirlar.length>30? `<div class="donem-onay-fazla">…ve ${fmtInt(d.yeniVeyaDegisenSatirlar.length-30)} tane daha</div>` : ''}
        ` : ''}

        ${d.eksikSatirlar.length ? `
          <div class="donem-onay-alt-baslik uyari">${fmtInt(d.eksikSatirlar.length)} kayıt arşivde var ama yeni dosyada yok — çıkarılacakları işaretleyin</div>
          <div class="donem-onay-liste">${eksikSatirlarHtml}</div>
          ${d.eksikSatirlar.length>60? `<div class="donem-onay-fazla">…ve ${fmtInt(d.eksikSatirlar.length-60)} tane daha (otomatik korunur)</div>` : ''}
        ` : ''}
      </div>
    `;
  };

  const overlay = document.createElement('div');
  overlay.className = 'upload-overlay';
  overlay.id = 'donemOnayOverlay';
  overlay.innerHTML = `
    <div class="upload-modal" style="max-width:560px;">
      <div class="upload-modal-head">
        <div class="upload-modal-title">Geçmiş Dönem Değişikliği Onayı</div>
      </div>
      <div style="color:rgba(255,255,255,.65); font-size:12.5px; margin-bottom:14px; line-height:1.6;">
        Yüklediğiniz Netsis dosyasında, aktif çalıştığınız ayın dışında kalan dönemlere ait
        değişiklikler bulundu. Aşağıdaki dönemleri kontrol edin.
      </div>
      <div id="donemOnayGovde">
        ${onayBekleyenDonemler.map(donemBlokHtml).join('')}
      </div>
      <button type="button" class="upload-build-btn" id="btnDonemOnayUygula" style="margin-top:16px;">
        <i class="fa-solid fa-check" aria-hidden="true"></i> Tümünü Göz Ardı Et ve Uygula
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('btnDonemOnayUygula').addEventListener('click', async ()=>{
    const cikarilacakByDonem = new Map(); // donemIndex -> Set(faturaKey)
    overlay.querySelectorAll('.donem-onay-cikar-cb:checked').forEach(cb=>{
      const dIndex = cb.dataset.donemIndex;
      if(!cikarilacakByDonem.has(dIndex)) cikarilacakByDonem.set(dIndex, new Set());
      cikarilacakByDonem.get(dIndex).add(cb.dataset.faturaKey);
    });

    for(let i=0; i<onayBekleyenDonemler.length; i++){
      const d = onayBekleyenDonemler[i];
      const cikarilacaklar = cikarilacakByDonem.get(String(i)) || new Set();
      await donemOnayiUygula(d, cikarilacaklar);
    }

    overlay.remove();
    renderDonemPaneli();
  });
}

// ===== NETSİS HAM VERİ ONAY MODALI =====
// donemOnayModaliAc'a çok benzer, ama İŞLENMİŞ rapor satırları değil HAM Netsis Excel
// satırları üzerinde çalışır (bkz. js/10-netsis-birlestir.js) — çünkü bu, dosya
// yüklenirken (rapor henüz hesaplanmadan) tetiklenir. Onaydan sonra doğrudan
// state.kaynaklar.netsis.rows güncellenir (arşive değil, canlı kaynağın kendisine).
function netsisOnayModaliAc(onayBekleyenDonemler){
  if(!onayBekleyenDonemler || !onayBekleyenDonemler.length) return;
  if(document.getElementById('netsisOnayOverlay')) return; // zaten açık, tekrar açma

  const donemBlokHtml = (d, dIndex)=>{
    const yeniSatirlarHtml = d.yeniVeyaDegisenSatirlar.slice(0, 30).map(hamSatir=>`
      <div class="donem-onay-satir">
        <span class="donem-onay-fno">${escapeHtml(hamSatir['Belge No']||'')}</span>
        <span class="donem-onay-unvan">${escapeHtml(hamSatir['Cari İsim']||'')}</span>
        <span class="donem-onay-tutar">${fmtTL(toNumber(hamSatir['Genel Toplam']))}</span>
      </div>
    `).join('');

    const eksikSatirlarHtml = d.eksikSatirlar.slice(0, 60).map((hamSatir)=>`
      <label class="donem-onay-eksik-satir">
        <input type="checkbox" class="netsis-onay-cikar-cb" data-donem-index="${dIndex}" data-anahtar="${escapeHtml(netsisHamSatirAnahtarUret(hamSatir))}">
        <span class="donem-onay-fno">${escapeHtml(hamSatir['Belge No']||'')}</span>
        <span class="donem-onay-unvan">${escapeHtml(hamSatir['Cari İsim']||'')}</span>
        <span class="donem-onay-tutar">${fmtTL(toNumber(hamSatir['Genel Toplam']))}</span>
      </label>
    `).join('');

    return `
      <div class="donem-onay-blok">
        <div class="donem-onay-blok-baslik"><i class="fa-solid fa-calendar-week" aria-hidden="true"></i> ${escapeHtml(d.donemEtiket)}</div>

        ${d.yeniVeyaDegisenSatirlar.length ? `
          <div class="donem-onay-alt-baslik ok">${fmtInt(d.yeniVeyaDegisenSatirlar.length)} yeni/değişen kayıt — otomatik eklendi</div>
          <div class="donem-onay-liste">${yeniSatirlarHtml}</div>
          ${d.yeniVeyaDegisenSatirlar.length>30? `<div class="donem-onay-fazla">…ve ${fmtInt(d.yeniVeyaDegisenSatirlar.length-30)} tane daha</div>` : ''}
        ` : ''}

        ${d.eksikSatirlar.length ? `
          <div class="donem-onay-alt-baslik uyari">${fmtInt(d.eksikSatirlar.length)} kayıt eski veride vardı ama yeni dosyada yok — çıkarılacakları işaretleyin (işaretlenmeyenler korunur)</div>
          <div class="donem-onay-liste">${eksikSatirlarHtml}</div>
          ${d.eksikSatirlar.length>60? `<div class="donem-onay-fazla">…ve ${fmtInt(d.eksikSatirlar.length-60)} tane daha (otomatik korunur)</div>` : ''}
        ` : ''}
      </div>
    `;
  };

  const overlay = document.createElement('div');
  overlay.className = 'upload-overlay';
  overlay.id = 'netsisOnayOverlay';
  overlay.innerHTML = `
    <div class="upload-modal" style="max-width:560px;">
      <div class="upload-modal-head">
        <div class="upload-modal-title">Netsis Verisi — Geçmiş Dönem Değişikliği Onayı</div>
      </div>
      <div style="color:rgba(255,255,255,.65); font-size:12.5px; margin-bottom:14px; line-height:1.6;">
        Yüklediğiniz Netsis dosyasında, aktif çalıştığınız ayın dışında kalan dönemlere ait
        değişiklikler bulundu. Yeni/değişen kayıtlar zaten otomatik eklendi — eksik kayıtlar
        için aşağıdan karar verin.
      </div>
      <div id="netsisOnayGovde">
        ${onayBekleyenDonemler.map(donemBlokHtml).join('')}
      </div>
      <button type="button" class="upload-build-btn" id="btnNetsisOnayUygula" style="margin-top:16px;">
        <i class="fa-solid fa-check" aria-hidden="true"></i> Tümünü Göz Ardı Et ve Uygula
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('btnNetsisOnayUygula').addEventListener('click', async ()=>{
    const cikarilacakAnahtarlar = new Set();
    overlay.querySelectorAll('.netsis-onay-cikar-cb:checked').forEach(cb=>{
      cikarilacakAnahtarlar.add(cb.dataset.anahtar);
    });

    if(cikarilacakAnahtarlar.size){
      state.kaynaklar.netsis.rows = netsisOnayiUygula(state.kaynaklar.netsis.rows, cikarilacakAnahtarlar);
      await saveKaynaklarToStorage();
      guncelleRaporOlusturButonu();
      if(typeof toastGoster === 'function') toastGoster(`${cikarilacakAnahtarlar.size} kayıt Netsis verisinden çıkarıldı`, 'basarili');
    }

    overlay.remove();
  });
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay){ /* dışarı tıklayınca kapanmasın — kullanıcı bilinçli karar vermeli */ } });
}

// ===== AY SONU KONTROLÜ 2-3-4: Dönem paneli =====
// Dönem seçici (arşivdeki aylar) + seçili döneme göre: önceki ayla KPI karşılaştırması,
// gün bazlı kapsama boşlukları, KDV/tutar dönem toplamı çapraz kontrolü.
let donemPaneliAcikMi = false;

function aktifGoruntulenenDonemId(){
  if(state.goruntulenenDonemId) return state.goruntulenenDonemId;
  return state.rapor ? raporunAitOlduguDonem(state.rapor) : null;
}

function donemKarsilastirmaSatiriHtml(label, veri, iyiYonAzalis){
  if(!veri) return '';
  const fark = veri.fark;
  const isaretIyiMi = iyiYonAzalis ? fark <= 0 : fark >= 0;
  const renk = fark===0 ? 'var(--ink-faint)' : (isaretIyiMi ? 'var(--green)' : 'var(--red)');
  const ok = fark===0 ? '' : (fark>0 ? '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>' : '<i class="fa-solid fa-arrow-down" aria-hidden="true"></i>');
  return `
    <div class="donem-kars-satir">
      <span class="donem-kars-lbl">${escapeHtml(label)}</span>
      <span class="donem-kars-eski">${fmtInt(veri.eski)}</span>
      <i class="fa-solid fa-arrow-right-long donem-kars-ok-ara" aria-hidden="true"></i>
      <span class="donem-kars-yeni">${fmtInt(veri.yeni)}</span>
      <span class="donem-kars-fark" style="color:${renk};">${ok} ${fark>0?'+':''}${fmtInt(fark)}</span>
    </div>
  `;
}

function renderDonemPaneli(){
  const el = document.getElementById('donemPaneliKap');
  if(!el) return;
  const donemler = donemListesi();
  if(!donemler.length){ el.innerHTML = ''; return; }

  const goruntulenenId = aktifGoruntulenenDonemId();
  const karsilastirma = goruntulenenId ? donemKarsilastirmaHesapla(goruntulenenId) : null;
  const bosluklar = goruntulenenId ? gunBazliBosluklariHesapla(goruntulenenId) : [];
  const toplamOzet = goruntulenenId ? donemToplamOzetiHesapla(goruntulenenId) : null;

  const donemSecenekleri = donemler.map(d=>`<option value="${escapeHtml(d.donemId)}" ${d.donemId===goruntulenenId?'selected':''}>${escapeHtml(donemEtiketUret(d.donemId))}${!state.goruntulenenDonemId && d.donemId===goruntulenenId? ' (güncel)':''}</option>`).join('');

  const karsHtml = karsilastirma && karsilastirma.farklar ? `
    <div class="donem-kars-blok">
      <div class="donem-kars-baslik">
        <i class="fa-solid fa-scale-balanced" aria-hidden="true"></i> ${escapeHtml(donemEtiketUret(karsilastirma.oncekiId))} → ${escapeHtml(donemEtiketUret(karsilastirma.donemId))}
        ${karsilastirma.eslesmeOraniFarki!=null ? `<span class="donem-kars-oran" style="color:${karsilastirma.eslesmeOraniFarki>=0?'var(--green)':'var(--red)'};">eşleşme oranı ${karsilastirma.eslesmeOraniFarki>=0?'+':''}${karsilastirma.eslesmeOraniFarki.toFixed(1).replace('.',',')} puan</span>` : ''}
      </div>
      ${donemKarsilastirmaSatiriHtml('Toplam fatura', karsilastirma.farklar.toplam, false)}
      ${donemKarsilastirmaSatiriHtml('Eşleşti', karsilastirma.farklar.eslesti, false)}
      ${donemKarsilastirmaSatiriHtml("Netsis'te yok", karsilastirma.farklar.islenmemis, true)}
      ${donemKarsilastirmaSatiriHtml('Entegratörde yok', karsilastirma.farklar.entegratordeYok, true)}
      ${donemKarsilastirmaSatiriHtml('Tutar farkı olan', karsilastirma.farklar.fark, true)}
      ${donemKarsilastirmaSatiriHtml('Kontrol grubu', karsilastirma.farklar.kontrol, true)}
    </div>
  ` : (karsilastirma ? `<div class="donem-kars-yok">Bu dönemden önce arşivlenmiş bir dönem yok — karşılaştırma için en az iki dönem arşivlenmiş olmalı.</div>` : '');

  const bosluklarHtml = bosluklar.length ? `
    <div class="donem-boslukblok">
      <div class="donem-boslukblok-baslik"><i class="fa-solid fa-calendar-xmark" aria-hidden="true"></i> ${fmtInt(bosluklar.length)} günde kapsama boşluğu bulundu</div>
      <div class="donem-boslukblok-liste">
        ${bosluklar.slice(0,15).map(b=>`<div class="donem-bosluk-satir ${b.tur==='netsis_eksik'?'tur-netsis':'tur-entegrator'}"><i class="fa-solid ${b.tur==='netsis_eksik'?'fa-triangle-exclamation':'fa-plug-circle-xmark'}" aria-hidden="true"></i> ${escapeHtml(b.aciklama)}</div>`).join('')}
        ${bosluklar.length>15? `<div class="donem-bosluk-satir" style="color:var(--ink-faint);">…ve ${fmtInt(bosluklar.length-15)} gün daha</div>` : ''}
      </div>
    </div>
  ` : `<div class="donem-boslukblok-yok"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> Ay içinde gün bazlı kapsama boşluğu bulunamadı.</div>`;

  const kdvHtml = toplamOzet ? `
    <div class="donem-kdv-grid">
      <div class="donem-kdv-kart">
        <div class="donem-kdv-lbl">Entegratör toplam tutar</div>
        <div class="donem-kdv-deger">${fmtTL(toplamOzet.toplamTutar)}</div>
      </div>
      <div class="donem-kdv-kart">
        <div class="donem-kdv-lbl">Netsis toplam tutar (eşleşen)</div>
        <div class="donem-kdv-deger">${fmtTL(toplamOzet.toplamTutarNetsis)}</div>
      </div>
      <div class="donem-kdv-kart ${Math.abs(toplamOzet.tutarFarki)>1?'fark-var':''}">
        <div class="donem-kdv-lbl">Tutar farkı</div>
        <div class="donem-kdv-deger">${fmtTL(toplamOzet.tutarFarki)}</div>
      </div>
      <div class="donem-kdv-kart ${Math.abs(toplamOzet.kdvFarki)>1?'fark-var':''}">
        <div class="donem-kdv-lbl">KDV farkı (entegratör − Netsis)</div>
        <div class="donem-kdv-deger">${fmtTL(toplamOzet.kdvFarki)}</div>
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="donem-paneli ${donemPaneliAcikMi?'acik':''}">
      <div class="donem-paneli-ust" id="donemPaneliToggle">
        <div class="donem-paneli-baslik"><i class="fa-solid fa-box-archive" aria-hidden="true"></i> Ay Sonu Kontrol Paneli</div>
        <div class="donem-secici-wrap">
          <select id="donemSecici" class="donem-secici" aria-label="Görüntülenecek dönem">${donemSecenekleri}</select>
          ${state.goruntulenenDonemId ? `<button type="button" class="donem-canliya-don-btn" id="btnDonemCanliyaDon">Canlıya dön <i class="fa-solid fa-rotate-right" aria-hidden="true"></i></button>` : ''}
        </div>
        <i class="fa-solid fa-chevron-down donem-paneli-ok" aria-hidden="true"></i>
      </div>
      <div class="donem-paneli-govde" ${donemPaneliAcikMi?'':'hidden'}>
        ${karsHtml}
        ${kdvHtml}
        ${bosluklarHtml}
      </div>
    </div>
  `;

  document.getElementById('donemPaneliToggle').addEventListener('click', (e)=>{
    if(e.target.closest('#donemSecici') || e.target.closest('#btnDonemCanliyaDon')) return;
    donemPaneliAcikMi = !donemPaneliAcikMi;
    renderDonemPaneli();
  });
  const secici = document.getElementById('donemSecici');
  if(secici){
    secici.addEventListener('change', ()=> donemGoruntule(secici.value));
    secici.addEventListener('click', (e)=> e.stopPropagation());
  }
  const canliyaDonBtn = document.getElementById('btnDonemCanliyaDon');
  if(canliyaDonBtn){
    canliyaDonBtn.addEventListener('click', (e)=>{ e.stopPropagation(); donemCanliyaDon(); });
  }
}

// Arşivlenmiş bir dönemi salt-görüntüleme modunda açar — tablo/KPI'lar o dönemin
// SNAPSHOT'ını gösterir, "Raporu Oluştur" tıklanmadan mevcut yüklü dosyalar etkilenmez.
function donemGoruntule(donemId){
  const donem = state.donemler[donemId];
  if(!donem) return;
  state.goruntulenenDonemId = donemId;
  state.rapor = raporEksikAlanlariTamamla(JSON.parse(JSON.stringify(donem.rapor)));
  aktifGrup='tumu'; aktifDurum='tumu'; aktifKaynak='tumu'; aramaMetni=''; sayfayiSifirla();
  const topbarSub = document.getElementById('topbarSub');
  if(topbarSub) topbarSub.textContent = `📁 Arşiv görünümü: ${donemEtiketUret(donemId)} · ${state.rapor.faturalar.length} kayıt (salt görüntüleme)`;
  renderKPIs();
  renderGroupTabs();
  renderGroupSections();
  renderDonemPaneli();
}

// Arşiv görünümünden çıkıp o an IndexedDB'de saklı GÜNCEL rapora geri döner.
async function donemCanliyaDon(){
  state.goruntulenenDonemId = null;
  const kayitliRapor = await loadRaporFromStorage();
  state.rapor = kayitliRapor && kayitliRapor.rapor ? raporEksikAlanlariTamamla(kayitliRapor.rapor) : null;
  aktifGrup='tumu'; aktifDurum='tumu'; aktifKaynak='tumu'; aramaMetni=''; sayfayiSifirla();
  const topbarSub = document.getElementById('topbarSub');
  if(topbarSub && state.rapor){
    topbarSub.textContent = `Son güncelleme · ${state.rapor.faturalar.length} kayıt`;
  }
  renderKPIs();
  renderGroupTabs();
  renderGroupSections();
  renderDonemPaneli();
}

// KPI: "Toplam Fatura" mavi birincil kart + 5 beyaz ikonlu durum kartı. Kartlar aynı
// zamanda durum filtresidir (ayrı bir durum çip satırı yok); aktif olana tekrar tıklamak
// filtreyi sıfırlar (toggle). Birincil karta tıklamak "Tümü"ye döner.
function renderKPIs(){
  renderYetimUyari();
  renderTutarOzeti();
  const satirlar = aktifGrupSatirlari();
  const kpi = state.rapor ? kpiHesapla(satirlar) : {toplam:0,eslesti:0,islenmemis:0,entegratordeYok:0,fark:0,red:0};
  const el = document.getElementById('kpiRow');

  const toplamTanim = KPI_TANIM.find(t=> t.key==='toplam');
  const durumTanimlar = KPI_TANIM.filter(t=> t.key!=='toplam');
  const eslesmeYuzde = yuzdeStr(kpi.eslesti, kpi.toplam);

  const kartHtml = durumTanimlar.map(t=>{
    const deger = kpi[t.key];
    const aktif = aktifDurum===t.durum;
    const yuzde = yuzdeStr(deger, kpi.toplam);
    return `
      <button type="button" class="kpi ${t.cls} ${aktif?'kpi-active':''}" data-durum="${t.durum}">
        <div class="ic"><i class="${t.icon}" aria-hidden="true"></i></div>
        <div class="l">${t.label}</div>
        <div class="v">${fmtInt(deger)}</div>
        <div class="p">${yuzde || '—'}</div>
        <i class="${t.icon} filigran" aria-hidden="true"></i>
      </button>
    `;
  }).join('');

  el.innerHTML = `
    <button type="button" class="kpi-ana ${aktifDurum==='tumu'?'hero-active':''}" data-durum="tumu">
      <div class="l">${toplamTanim.label}</div>
      <div class="v">${fmtInt(kpi.toplam)}</div>
      <div class="s">Entegratör kayıtları${eslesmeYuzde? ` · ${eslesmeYuzde} eşleşme` : ''}</div>
      <i class="fa-regular fa-file-lines filigran" aria-hidden="true"></i>
    </button>
    ${kartHtml}
  `;

  el.querySelector('.kpi-ana').addEventListener('click', ()=>{
    aktifDurum = 'tumu'; sayfayiSifirla(); renderKPIs(); renderGroupSections();
  });
  el.querySelectorAll('.kpi').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const secilen = btn.dataset.durum;
      aktifDurum = (aktifDurum===secilen) ? 'tumu' : secilen; // toggle
      sayfayiSifirla(); renderKPIs(); renderGroupSections();
    });
  });
}

function renderGroupTabs(){
  const gruplar = state.rapor ? state.rapor.gruplar : {kesan:[],bayrampasa:[],kontrol:[],notlu:[]};
  const toplam = state.rapor ? state.rapor.faturalar.length : 0;
  const el = document.getElementById('groupTabs');
  const tabs = [
    {key:'tumu', label:'Tümü', cnt: toplam},
    {key:'kesan', label:'Keşan', cnt: gruplar.kesan.length},
    {key:'bayrampasa', label:'Bayrampaşa', cnt: gruplar.bayrampasa.length},
    {key:'kontrol', label:'Kontrol', cnt: gruplar.kontrol.length, warn:true},
    {key:'notlar', label:'Notlar', cnt: gruplar.notlu.length, note:true},
  ];
  el.innerHTML = tabs.map(t=>`
    <button type="button" class="group-tab ${t.key===aktifGrup?'active':''} ${t.warn?'cls-warn':''} ${t.note?'cls-note':''}" data-grup="${t.key}">
      ${t.note?'<i class="fa-solid fa-note-sticky" aria-hidden="true"></i> ':''}${t.label} <span class="cnt">${fmtInt(t.cnt)}</span>
    </button>
  `).join('');
  el.querySelectorAll('.group-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      aktifGrup = btn.dataset.grup;
      aktifDurum = 'tumu';
      aktifKaynak = 'tumu';
      sayfayiSifirla();
      renderGroupTabs(); renderKPIs(); renderGroupSections();
    });
  });
}

const AY_KISA_TR = ['OCA','ŞUB','MAR','NİS','MAY','HAZ','TEM','AĞU','EYL','EKİ','KAS','ARA'];

function tarihHucreHtml(faturaTarihi){
  if(!faturaTarihi) return '<span style="color:var(--ink-faint);">—</span>';
  const t = new Date(faturaTarihi);
  if(isNaN(t)) return '<span style="color:var(--ink-faint);">—</span>';
  return `
    <div class="td-date">
      <div class="date-tile"><div class="d">${t.getDate()}</div><div class="m">${AY_KISA_TR[t.getMonth()]}</div></div>
      <span class="date-year">${t.getFullYear()}</span>
    </div>
  `;
}

// Fatura no hücresi: numara + tıklanınca panoya kopyalayan küçük ikon butonu.
// Buton, satırın kendi tıklama olayına (detay modalını açan) yayılmasın diye
// event delegation içinde stopPropagation ile durdurulur (bkz. panoyaKopyalaBaglaEventleri).
function faturaNoHucreHtml(faturaNo){
  const deger = String(faturaNo==null?'':faturaNo);
  return `
    <span class="fno-hucre">
      <span class="fno">${escapeHtml(deger)}</span>
      <button type="button" class="fno-kopyala-btn" data-kopyala="${escapeHtml(deger)}" title="Fatura no'yu kopyala" aria-label="Fatura no'yu kopyala">
        <i class="fa-regular fa-copy" aria-hidden="true"></i>
      </button>
    </span>
  `;
}

// Cari kodu hücresi: fatura no hücresiyle aynı kopyalama mantığını paylaşır
// (bkz. panoyaKopyalaBaglaEventleri / fnoKopyalaDelegationBagla, data-kopyala
// attribute'unu her iki buton tipi için de dinler).
function cariKoduHucreHtml(cariKodu){
  const deger = String(cariKodu==null?'':cariKodu).trim();
  if(!deger){
    return `<span class="cari-kodu-yok">—</span>`;
  }
  return `
    <span class="fno-hucre">
      <span class="fno">${escapeHtml(deger)}</span>
      <button type="button" class="fno-kopyala-btn" data-kopyala="${escapeHtml(deger)}" title="Cari kodu'nu kopyala" aria-label="Cari kodu'nu kopyala">
        <i class="fa-regular fa-copy" aria-hidden="true"></i>
      </button>
    </span>
  `;
}

async function faturaNoKopyala(btn){
  const deger = btn.dataset.kopyala || '';
  try{
    await navigator.clipboard.writeText(deger);
  }catch(e){
    // Panoya erişim engellenmişse (izin/eski tarayıcı) sessiz bir yedek yöntem kullan.
    try{
      const ta = document.createElement('textarea');
      ta.value = deger;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }catch(e2){ return; }
  }
  const icon = btn.querySelector('i');
  if(!icon) return;
  const eskiClass = icon.className;
  btn.classList.add('kopyalandi');
  icon.className = 'fa-solid fa-check';
  setTimeout(()=>{
    icon.className = eskiClass;
    btn.classList.remove('kopyalandi');
  }, 1200);
}

// Tablo gövdesi her renderGroupSections çağrısında yeniden oluşturulduğu için, kopyala
// butonlarına tek tek dinleyici eklemek yerine sabit bir üst konteynere (document.body)
// delegation ile TEK SEFER bağlanır — böylece yeniden render sonrası dinleyici kaybolmaz.
let fnoKopyalaDelegationBagliMi = false;
function fnoKopyalaDelegationBagla(){
  if(fnoKopyalaDelegationBagliMi) return;
  fnoKopyalaDelegationBagliMi = true;
  document.body.addEventListener('click', (e)=>{
    const btn = e.target.closest('.fno-kopyala-btn');
    if(!btn) return;
    e.stopPropagation(); // satırın kendi tıklama işleyicisini (detay modalı) tetiklemesin
    e.preventDefault();
    faturaNoKopyala(btn);
  }, true); // capture fazı: tr/kart üzerindeki addEventListener'lardan ÖNCE çalışmalı ki stopPropagation onları engellesin
}

function faturaSatirHtml(f){
  const tutarGosterilen = f.yon==='netsis' ? f.netsisTutar : f.tutar;
  const manuelTanim = f.manuelDurum ? manuelDurumTanimBul(f.manuelDurum) : null;
  const notVarMi = f.not && f.not.trim();
  return `
    <tr class="row fatura-row" data-fatura-key="${escapeHtml(f.faturaKey)}" style="cursor:pointer;" tabindex="0" role="button" aria-label="${escapeHtml(f.faturaNo)} detayını aç">
      <td>${tarihHucreHtml(f.faturaTarihi)}</td>
      <td>${faturaNoHucreHtml(f.faturaNo)}</td>
      <td class="desc">${escapeHtml(f.gonderenUnvan)}</td>
      <td>${cariKoduHucreHtml(f.cariKodu)}</td>
      <td class="num">${fmtTL(tutarGosterilen)}</td>
      <td>${escapeHtml(f.sube)}</td>
      <td>${f.yon==='netsis' ? '<span class="src-badge">Netsis</span>' : '<span class="src-badge">Entegratör</span>'}</td>
      <td>
        <div class="durum-cell">
          <span class="badge ${durumBadgeClass(f.durum)}"><i class="${durumBadgeIcon(f.durum)}" aria-hidden="true"></i> ${escapeHtml(f.durumEtiket)}</span>
          ${manuelTanim ? `<span class="badge badge-manuel ${manuelTanim.cls}"><i class="${manuelTanim.icon}" aria-hidden="true"></i> ${escapeHtml(manuelTanim.label)}</span>` : ''}
        </div>
        ${notVarMi ? `<div class="satir-not-metni" title="${escapeHtml(f.not)}"><i class="fa-solid fa-note-sticky" aria-hidden="true"></i> ${escapeHtml(f.not)}</div>` : ''}
      </td>
    </tr>
  `;
}

const SIRALANABILIR_KOLONLAR = [
  {key:'faturaTarihi', label:'Tarih'},
  {key:'faturaNo', label:'Fatura no'},
  {key:'gonderenUnvan', label:'Gönderen'},
  {key:'cariKodu', label:'Cari kodu'},
  {key:'tutar', label:'Tutar'},
];

function siraDegerAl(f, alan){
  if(alan==='tutar') return f.yon==='netsis' ? (f.netsisTutar||0) : (f.tutar||0);
  if(alan==='faturaTarihi') return f.faturaTarihi ? new Date(f.faturaTarihi).getTime() : 0;
  if(alan==='faturaNo') return String(f.faturaNo||'');
  if(alan==='gonderenUnvan') return String(f.gonderenUnvan||'');
  if(alan==='cariKodu') return String(f.cariKodu||'');
  return '';
}

function satirlariSirala(satirlar){
  const kopya = [...satirlar];
  kopya.sort((a,b)=>{
    const va = siraDegerAl(a, siralamaAlani);
    const vb = siraDegerAl(b, siralamaAlani);
    let cmp;
    if(typeof va==='number' && typeof vb==='number') cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb),'tr');
    return siralamaYonu==='asc' ? cmp : -cmp;
  });
  return kopya;
}

function devaminiGosterHtml(toplamKayit){
  if(gosterilenSatirSayisi >= toplamKayit) return '';
  const kalan = toplamKayit - gosterilenSatirSayisi;
  const eklenecek = Math.min(SAYFA_ADIMI, kalan);
  return `
    <div class="load-more-wrap">
      <button type="button" class="load-more-btn" id="btnDevaminiGoster">
        <span>Devamını Göster (${fmtInt(eklenecek)} kayıt daha)</span>
        <i class="fa-solid fa-chevron-down" aria-hidden="true"></i>
      </button>
    </div>
  `;
}

// ÖNERİ 4: Fark (uyumsuzluk) görünümü. Kâr/zarar YOK — her fark, düzeltilmesi gereken bir
// tutmama. Sapmanın MUTLAK büyüklüğüne göre azalan sıralı (en büyük hata üstte). "Nerede
// tutmuyor" nötr bir ipucudur: hangi kaydın düzeltileceğini göstermek için.
function farkSatirHtml(f){
  const d = f.farkDetay || {};
  const sapma = Math.abs(d.tutarFarkTutari||0);
  const netsisDusuk = (d.tutarFarkTutari||0) > 0; // entegratör > netsis => netsis düşük
  const nerede = (d.tutarFarkTutari||0)===0 ? 'KDV farkı' : (netsisDusuk ? 'Netsis düşük' : 'Netsis yüksek');
  return `
    <tr class="row fatura-row" data-fatura-key="${escapeHtml(f.faturaKey)}" style="cursor:pointer;" tabindex="0" role="button" aria-label="${escapeHtml(f.faturaNo)} fark detayını aç">
      <td>${faturaNoHucreHtml(f.faturaNo)}</td>
      <td class="desc">${escapeHtml(f.gonderenUnvan)}</td>
      <td class="num amt-uyumsuz">${fmtTL(d.entegratorTutar)}</td>
      <td class="num amt-uyumsuz">${fmtTL(d.netsisTutar)}</td>
      <td><span class="fark-chip">${fmtTL(sapma)}</span></td>
      <td><span class="nerede">${nerede}</span></td>
    </tr>
  `;
}

function farkTabloHtml(satirlar){
  // Yalnızca gerçek "fark" durumundaki satırlar (manuel eşleşti işaretlenenler hariç tutulur —
  // onlar zaten durum='eslesti' olduğundan bu listeye düşmez).
  const farklar = satirlar.filter(f=> f.durum==='fark' && f.farkDetay);
  if(!farklar.length){
    return `<div class="section-card"><div class="section-label">Tutar Farkı</div><div class="empty-state">Bu filtreyle tutar/KDV farkı olan fatura bulunamadı.</div></div>`;
  }
  const sirali = [...farklar].sort((a,b)=> Math.abs(b.farkDetay.tutarFarkTutari||0) - Math.abs(a.farkDetay.tutarFarkTutari||0));
  const toplamSapma = sirali.reduce((a,f)=> a+Math.abs(f.farkDetay.tutarFarkTutari||0), 0);
  const enBuyuk = Math.abs(sirali[0].farkDetay.tutarFarkTutari||0);
  const gosterSayisi = Math.min(gosterilenSatirSayisi, sirali.length);
  const goster = sirali.slice(0, gosterSayisi);
  return `
    <div class="section-card">
      <div class="section-label">Tutar Farkı <span class="section-label-cnt">${fmtInt(sirali.length)} kayıt</span></div>
      <div class="fark-ozet-bar">
        <span class="fo-item">Tutmayan fatura: <b>${fmtInt(sirali.length)}</b></span>
        <span class="fo-item">Toplam sapma (mutlak): <b>${fmtTL(toplamSapma)}</b></span>
        <span class="fo-item">En büyük tek sapma: <b>${fmtTL(enBuyuk)}</b></span>
        <span class="fark-sort-hint"><i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i> Sapmaya göre sıralı</span>
      </div>
      <div class="twrap">
        <table class="data-table">
          <tr><th>Fatura No</th><th>Gönderen</th><th>Entegratör</th><th>Netsis</th><th>Fark (mutlak)</th><th>Nerede tutmuyor</th></tr>
          ${goster.map(farkSatirHtml).join('')}
        </table>
      </div>
      <div class="table-foot">
        <div class="tf-info">${fmtInt(1)} – ${fmtInt(gosterSayisi)} / ${fmtInt(sirali.length)} kayıt gösteriliyor</div>
      </div>
      ${devaminiGosterHtml(sirali.length)}
    </div>
  `;
}

function tabloHtml(satirlar, baslik){
  const sirali = satirlariSirala(satirlar);
  const okIcon = (key)=> siralamaAlani===key ? (siralamaYonu==='asc'?'<i class="fa-solid fa-arrow-up-short-wide" aria-hidden="true"></i>':'<i class="fa-solid fa-arrow-down-wide-short" aria-hidden="true"></i>') : '';
  const basliklarHtml = SIRALANABILIR_KOLONLAR.map(k=>`
    <th class="sortable-th ${siralamaAlani===k.key?'sorted':''}" data-sort="${k.key}">${k.label} ${okIcon(k.key)}</th>
  `).join('') + '<th>Şube</th><th>Kaynak</th><th>Durum</th>';

  if(!sirali.length){
    return `<div class="section-card"><div class="section-label">${baslik}</div><div class="empty-state">Bu filtreyle eşleşen fatura bulunamadı.</div></div>`;
  }

  const gosterSayisi = Math.min(gosterilenSatirSayisi, sirali.length);
  const goster = sirali.slice(0, gosterSayisi);

  return `
    <div class="section-card">
      <div class="section-label">${baslik} <span class="section-label-cnt">${fmtInt(sirali.length)} kayıt</span></div>
      <div class="twrap">
        <table class="data-table">
          <tr>${basliklarHtml}</tr>
          ${goster.map(faturaSatirHtml).join('')}
        </table>
      </div>
      <div class="table-foot">
        <div class="tf-info">${fmtInt(sirali.length ? 1 : 0)} – ${fmtInt(gosterSayisi)} / ${fmtInt(sirali.length)} kayıt gösteriliyor</div>
      </div>
      ${devaminiGosterHtml(sirali.length)}
    </div>
  `;
}

function kaynagaGoreFiltrele(satirlar){
  if(aktifKaynak==='tumu') return satirlar;
  if(aktifKaynak==='efatura') return satirlar.filter(f=> f.kaynak==='logo' || f.kaynak==='qnb');
  if(aktifKaynak==='earsiv') return satirlar.filter(f=> f.kaynak==='earsiv');
  return satirlar;
}

function renderKaynakSegment(satirlar){
  const efaturaCnt = satirlar.filter(f=> f.kaynak==='logo' || f.kaynak==='qnb').length;
  const earsivCnt = satirlar.filter(f=> f.kaynak==='earsiv').length;
  const secenekler = [
    {key:'tumu', label:'Tümü', cnt: satirlar.length},
    {key:'efatura', label:'E-Fatura', cnt: efaturaCnt},
    {key:'earsiv', label:'E-Arşiv', cnt: earsivCnt},
  ];
  return `
    <div class="kaynak-segment">
      ${secenekler.map(s=>`
        <button type="button" class="kaynak-seg-btn ${s.key===aktifKaynak?'active':''}" data-kaynak="${s.key}">
          ${s.label} <span class="cnt">${fmtInt(s.cnt)}</span>
        </button>
      `).join('')}
    </div>
  `;
}

const DURUM_RENK = {
  eslesti: '#1FA55A',
  fark: '#7C5CFC',
  islenmemis: '#E23E3E',
  entegratorde_yok: '#F08A1D',
  red: '#8B96AB',
};

// NOT: Eski ayrı "durum çip satırı" (renderStatusFilter) TASARIM 2 ile kaldırıldı — durum
// filtresi artık üstteki KPI çipleridir (renderKPIs). DURUM_RENK yukarıda ileride gerekebilir
// diye korunuyor.

function durumaGoreFiltrele(satirlar){
  if(aktifDurum==='tumu') return satirlar;
  return satirlar.filter(f=> f.durum===aktifDurum);
}

function aramayaGoreFiltrele(satirlar){
  const q = aramaMetni.trim().toLocaleLowerCase('tr-TR');
  if(!q) return satirlar;
  return satirlar.filter(f=>
    String(f.gonderenUnvan||'').toLocaleLowerCase('tr-TR').includes(q) ||
    String(f.faturaNo||'').toLocaleLowerCase('tr-TR').includes(q) ||
    String(f.cariKodu||'').toLocaleLowerCase('tr-TR').includes(q)
  );
}

function renderSearchBox(){
  return `
    <div class="search-box-wrap">
      <input type="text" id="aramaKutusu" class="search-box" placeholder="Cari unvan, fatura no veya cari kodu ile ara..." value="${escapeHtml(aramaMetni)}">
      <i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
    </div>
  `;
}

function notluKartlarHtml(satirlar){
  if(!satirlar.length){
    return `<div class="section-card"><div class="empty-state">Henüz not eklenmiş bir fatura yok. Bir faturaya tıklayıp not ekleyebilir veya manuel durum işaretleyebilirsiniz.</div></div>`;
  }
  const sirali = [...satirlar].sort((a,b)=>{
    const ta = a.notGuncellemeZamani ? new Date(a.notGuncellemeZamani).getTime() : 0;
    const tb = b.notGuncellemeZamani ? new Date(b.notGuncellemeZamani).getTime() : 0;
    return tb - ta;
  });
  return `
    <div class="section-card">
      <div class="section-label">Notlar <span class="section-label-cnt">${fmtInt(sirali.length)} fatura</span></div>
      <div class="not-kart-liste">
        ${sirali.map(f=>{
          const notVarMi = f.not && f.not.trim();
          const manuelTanim = f.manuelDurum ? manuelDurumTanimBul(f.manuelDurum) : null;
          const gercekDurum = f.manuelDurum ? f.orijinalDurum : f.durum;
          const gercekDurumEtiket = f.manuelDurum ? f.orijinalDurumEtiket : f.durumEtiket;
          return `
          <div class="not-kart" data-fatura-key="${escapeHtml(f.faturaKey)}">
            <div class="not-kart-ust">
              <div>
                ${faturaNoHucreHtml(f.faturaNo)}
                <span class="not-kart-cari">${escapeHtml(f.gonderenUnvan)}</span>
              </div>
              <div class="not-kart-tutar">${fmtTL(f.yon==='netsis' ? f.netsisTutar : f.tutar)}</div>
            </div>
            <div class="not-kart-badges">
              <span class="badge ${durumBadgeClass(gercekDurum)}"><i class="${durumBadgeIcon(gercekDurum)}" aria-hidden="true"></i> ${escapeHtml(gercekDurumEtiket)}</span>
              ${manuelTanim ? `<span class="badge badge-manuel ${manuelTanim.cls}"><i class="${manuelTanim.icon}" aria-hidden="true"></i> ${escapeHtml(manuelTanim.label)}</span>` : ''}
            </div>
            ${notVarMi ? `<div class="not-kart-metin">${escapeHtml(f.not)}</div>` : `<div class="not-kart-metin not-kart-metin-bos">Not eklenmemiş — detayına tıklayıp not ekleyebilirsiniz.</div>`}
            ${f.notGuncellemeZamani ? `<div class="not-kart-zaman">Son güncelleme: ${new Date(f.notGuncellemeZamani).toLocaleString('tr-TR')}</div>` : ''}
          </div>
        `;}).join('')}
      </div>
    </div>
  `;
}

function renderGroupSections(){
  const el = document.getElementById('groupSections');
  if(!state.rapor){
    el.innerHTML = `<div class="section-card"><div class="empty-state">Rapor oluşturmak için soldaki panelden dosyaları yükleyip "Raporu Oluştur"a basın.</div></div>`;
    return;
  }
  const grupSatirlariKaynaksiz = aktifGrupSatirlariKaynaksiz();
  const kaynakFiltreli = aktifGrupSatirlari();
  const filtreliSatirlar = aramayaGoreFiltrele(durumaGoreFiltrele(kaynakFiltreli));
  const kaynakSegment = renderKaynakSegment(grupSatirlariKaynaksiz);
  const arama = renderSearchBox();

  // TASARIM 3: kaynak segmenti + arama TEK birleşik araç çubuğu satırında.
  // TASARIM 2: ayrı durum çip satırı (renderStatusFilter) artık YOK — durum filtresi
  // üstteki KPI çipleridir.
  const ustSatir = `
    <div class="filtre-bar">
      ${kaynakSegment}
      ${arama}
    </div>
  `;

  // Durum filtresi "fark" ise özel uyumsuzluk görünümü (sapmaya göre sıralı) kullanılır;
  // aksi halde normal tablo. Böylece her grupta fark filtresi akıllı görünüme geçer.
  const icerikTablosu = (satirlar, baslik)=>
    aktifDurum==='fark' ? farkTabloHtml(satirlar) : tabloHtml(satirlar, baslik);

  if(aktifGrup==='tumu'){
    el.innerHTML = ustSatir + icerikTablosu(filtreliSatirlar, 'Fatura Listesi');
  }else if(aktifGrup==='kesan'){
    el.innerHTML = ustSatir + icerikTablosu(filtreliSatirlar, 'Keşan · Keşan Efes dahil');
  }else if(aktifGrup==='bayrampasa'){
    el.innerHTML = ustSatir + icerikTablosu(filtreliSatirlar, 'Bayrampaşa · Bayrampaşa Efes dahil');
  }else if(aktifGrup==='kontrol'){
    el.innerHTML = `
      ${ustSatir}
      <div class="control-banner">
        <span class="lbl">Kontrol listesi — VKN hiçbir müşteri master'da bulunamadı</span>
        <span class="cnt">${fmtInt(kaynakFiltreli.length)} fatura</span>
      </div>
      ${icerikTablosu(filtreliSatirlar, 'Kontrol')}
    `;
  }else if(aktifGrup==='notlar'){
    el.innerHTML = `
      ${arama}
      ${notluKartlarHtml(aramayaGoreFiltrele(kaynakFiltreli))}
    `;
  }

  el.querySelectorAll('.kaynak-seg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{ aktifKaynak = btn.dataset.kaynak; sayfayiSifirla(); renderKPIs(); renderGroupSections(); });
  });
  // (Ayrı durum çip satırı kaldırıldı — durum filtresi artık üstteki KPI çiplerinde.)
  el.querySelectorAll('.status-mini-card--kullanilmiyor').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const secilen = btn.dataset.durum;
      aktifDurum = (aktifDurum===secilen) ? 'tumu' : secilen;
      sayfayiSifirla();
      renderKPIs();
      renderGroupSections();
    });
  });
  el.querySelectorAll('.sortable-th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.sort;
      if(siralamaAlani===key) siralamaYonu = siralamaYonu==='asc' ? 'desc' : 'asc';
      else { siralamaAlani = key; siralamaYonu = 'desc'; }
      renderGroupSections();
    });
  });

  const btnDevaminiGoster = el.querySelector('#btnDevaminiGoster');
  if(btnDevaminiGoster){
    btnDevaminiGoster.addEventListener('click', ()=>{
      gosterilenSatirSayisi += SAYFA_ADIMI;
      renderGroupSections();
    });
  }
  el.querySelectorAll('.fatura-row').forEach(tr=>{
    tr.addEventListener('click', ()=> faturaDetayModalAc(tr.dataset.faturaKey));
    // ÖNERİ 7: klavye erişimi — Enter veya Space ile satır detayını aç.
    tr.addEventListener('keydown', (e)=>{
      if(e.key==='Enter' || e.key===' '){ e.preventDefault(); faturaDetayModalAc(tr.dataset.faturaKey); }
    });
  });
  el.querySelectorAll('.not-kart').forEach(kart=>{
    kart.addEventListener('click', ()=> faturaDetayModalAc(kart.dataset.faturaKey));
  });
  const aramaKutusu = el.querySelector('#aramaKutusu');
  if(aramaKutusu){
    // ÖNERİ 7: 150ms debounce — her tuş vuruşunda tüm listeyi yeniden çizmek yerine yazma
    // durunca bir kez çizeriz. Büyük listelerde (800+ satır) yazma akıcılaşır.
    aramaKutusu.addEventListener('input', (e)=>{
      aramaMetni = e.target.value;
      clearTimeout(aramaDebounceTimer);
      aramaDebounceTimer = setTimeout(()=>{
        sayfayiSifirla();
        renderGroupSections();
        const yeni = document.getElementById('aramaKutusu');
        if(yeni){ yeni.focus(); yeni.setSelectionRange(yeni.value.length, yeni.value.length); }
      }, 150);
    });
  }
}

function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function farkDetayHtml(f){
  const d = f.farkDetay;
  if(!d) return '';
  return `
    <div class="upload-section-label">Tutar ${d.tutarFarkVar?'<span style="color:#FFB65C;">— fark var</span>':'<span style="color:#8FE0AE;">— eşleşiyor</span>'}</div>
    <div class="upload-row">
      <div>
        <div class="upload-row-name">Entegratör</div>
        <div class="upload-row-status ok" style="color:#fff;font-size:13px;">${fmtTL(d.entegratorTutar)}</div>
      </div>
      <div style="text-align:right;">
        <div class="upload-row-name">Netsis</div>
        <div class="upload-row-status ok" style="color:#fff;font-size:13px;">${fmtTL(d.netsisTutar)}</div>
      </div>
    </div>
    <div style="text-align:right; font-size:12px; color:${d.tutarFarkVar?'#FFB65C':'rgba(255,255,255,.45)'}; margin-top:6px;">
      Fark: ${fmtTL(d.tutarFarkTutari)}
    </div>
    ${d.kdvKontrolVarMi ? `
      <div class="upload-section-label" style="margin-top:14px;">KDV ${d.kdvFarkVar?'<span style="color:#FFB65C;">— fark var</span>':'<span style="color:#8FE0AE;">— eşleşiyor</span>'}</div>
      <div class="upload-row">
        <div>
          <div class="upload-row-name">Entegratör</div>
          <div class="upload-row-status ok" style="color:#fff;font-size:13px;">${fmtTL(d.entegratorKdv)}</div>
        </div>
        <div style="text-align:right;">
          <div class="upload-row-name">Netsis</div>
          <div class="upload-row-status ok" style="color:#fff;font-size:13px;">${fmtTL(d.netsisKdv)}</div>
        </div>
      </div>
      <div style="text-align:right; font-size:12px; color:${d.kdvFarkVar?'#FFB65C':'rgba(255,255,255,.45)'}; margin-top:6px;">
        Fark: ${fmtTL(d.kdvFarkTutari)}
      </div>
    ` : `
      <div class="upload-note" style="margin-top:14px;">Bu kaynakta (QNB) KDV bilgisi yer almadığı için KDV karşılaştırması yapılmıyor — sadece toplam tutar kontrol edilir.</div>
    `}
  `;
}

async function faturaDetayKaydet(faturaKey, overlay, kapat){
  const seciliDurumBtn = overlay.querySelector('.manuel-durum-btn.active');
  const durum = seciliDurumBtn ? (seciliDurumBtn.dataset.durum || null) : null;
  const notMetni = overlay.querySelector('#faturaNotAlani').value;

  await manuelKaydiGuncelle(faturaKey, {durum, not: notMetni});

  state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari, state.zincirVknListesi, state.faturaSubeAtamalari);
  await saveRaporToStorage();

  if(typeof kapat==='function') kapat(); else overlay.remove();
  renderKPIs();
  renderGroupTabs();
  renderGroupSections();
}

function subeAtamaBlokHtml(f){
  const vknYokMu = !f.vkn; // VKN/TCKN hiç okunamamış (örn. bazı E-Arşiv satırlarında olabilir)
  const zincirMi = !vknYokMu && vknZincirMi(f.vkn); // Migros gibi: VKN paylaşımlı marka
  const manuelAtanmisMi = !vknYokMu ? vknSubesiAtanmisMi(f.vkn) : null; // 'kesan' | 'bayrampasa' | null (VKN bazlı, zincir DEĞİLSE geçerli)
  const faturaAtanmisMi = faturaSubesiAtanmisMi(f.faturaKey); // 'kesan' | 'bayrampasa' | null (fatura bazlı, sadece zincirler için)
  const suanSubeGrubu = f.subeGrup; // computeRapor'un o an atadığı grup (kontrol/kesan/bayrampasa)

  // VKN/TCKN HİÇ YOK: bu faturada VKN alanı boş (Excel'de eksik/okunamamış olabilir).
  // VKN-bazlı hiçbir atama (zincir işaretleme, kalıcı VKN ataması) mantıklı olmaz çünkü
  // atanacak bir VKN yok — bunun yerine SADECE fatura bazlı (faturaKey'e göre) atama
  // sunuyoruz, kullanıcıyı bilgilendiriyoruz.
  if(vknYokMu){
    const durumEtiketi = faturaAtanmisMi
      ? `<span class="badge badge-manuel ${faturaAtanmisMi==='kesan'?'badge-success':'badge-purple'}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i> ${faturaAtanmisMi==='kesan'?'Keşan':'Bayrampaşa'} (bu fatura için, elle)</span>`
      : `<span class="badge badge-warn"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i> VKN/TCKN okunamadı — sadece bu fatura için atama yapılabilir</span>`;
    return `
      <div class="sube-atama-blok">
        <div class="upload-section-label">Şube</div>
        <div class="sube-durum-etiket">${durumEtiketi}</div>
        <div class="sube-atama-grid">
          <button type="button" class="sube-atama-btn fatura-sube-atama-btn ${faturaAtanmisMi==='kesan'?'active':''}" data-sube="kesan">
            <i class="fa-solid fa-building" aria-hidden="true"></i> Keşan'a ata
          </button>
          <button type="button" class="sube-atama-btn fatura-sube-atama-btn ${faturaAtanmisMi==='bayrampasa'?'active':''}" data-sube="bayrampasa">
            <i class="fa-solid fa-building" aria-hidden="true"></i> Bayrampaşa'ya ata
          </button>
        </div>
        ${faturaAtanmisMi ? `<button type="button" class="manuel-durum-temizle" id="btnFaturaSubeAtamaTemizle"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Bu faturanın atamasını kaldır</button>` : ''}
        <div class="sube-atama-not">Bu faturada VKN/TCKN bilgisi bulunamadı, bu yüzden VKN'ye bağlı kalıcı bir atama (zincir işaretleme gibi) yapılamıyor — atama sadece bu faturaya özel kalır.</div>
      </div>
    `;
  }

  // ZİNCİR VKN (örn. Migros): VKN bazlı atama burada GEÇERSİZ — her fatura kendi
  // başına, faturaKey'e göre atanır. Zincir listesinden çıkarma seçeneği de sunulur.
  if(zincirMi){
    const durumEtiketi = faturaAtanmisMi
      ? `<span class="badge badge-manuel ${faturaAtanmisMi==='kesan'?'badge-success':'badge-purple'}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i> ${faturaAtanmisMi==='kesan'?'Keşan':'Bayrampaşa'} (bu fatura için, elle)</span>`
      : `<span class="badge badge-warn"><i class="fa-solid fa-link" aria-hidden="true"></i> Zincir VKN — her fatura kendi başına atanır</span>`;

    return `
      <div class="sube-atama-blok">
        <div class="upload-section-label">Şube</div>
        <div class="sube-durum-etiket">${durumEtiketi}</div>
        <div class="sube-atama-grid">
          <button type="button" class="sube-atama-btn fatura-sube-atama-btn ${faturaAtanmisMi==='kesan'?'active':''}" data-sube="kesan">
            <i class="fa-solid fa-building" aria-hidden="true"></i> Keşan'a ata
          </button>
          <button type="button" class="sube-atama-btn fatura-sube-atama-btn ${faturaAtanmisMi==='bayrampasa'?'active':''}" data-sube="bayrampasa">
            <i class="fa-solid fa-building" aria-hidden="true"></i> Bayrampaşa'ya ata
          </button>
        </div>
        ${faturaAtanmisMi ? `<button type="button" class="manuel-durum-temizle" id="btnFaturaSubeAtamaTemizle"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Bu faturanın atamasını kaldır</button>` : ''}
        <div class="sube-atama-not">Bu VKN "zincir" olarak işaretli (aynı VKN'yi birden fazla şubede/bölgede kullanan marka) — atama SADECE bu faturaya özeldir, aynı VKN'nin başka faturalarını etkilemez.</div>
        <button type="button" class="sube-atama-link" id="btnZincirVknCikar"><i class="fa-solid fa-unlink" aria-hidden="true"></i> Bu VKN'yi zincir listesinden çıkar</button>
      </div>
    `;
  }

  // ZİNCİR DEĞİL: normal VKN bazlı akış. "Zincir olarak işaretle" seçeneği HER ZAMAN
  // gösterilir (VKN otomatik Keşan/Bayrampaşa'ya düşmüş olsa bile) — aksi halde Migros
  // gibi Müşteri Master'da zaten kayıtlı bir VKN için bu seçenek hiç görünmezdi
  // (tavuk-yumurta sorunu: zincir işaretlemek için önce Kontrol'e düşmesi gerekmiyor,
  // tam tersi olmalı — Kontrol'e düşmesi İÇİN zincir işaretlenir).
  const otomatikAtanmisMi = !manuelAtanmisMi && suanSubeGrubu !== 'kontrol'; // Müşteri Master'dan geldi
  const durumEtiketi = manuelAtanmisMi
    ? `<span class="badge badge-manuel ${manuelAtanmisMi==='kesan'?'badge-success':'badge-purple'}"><i class="fa-solid fa-thumbtack" aria-hidden="true"></i> ${manuelAtanmisMi==='kesan'?'Keşan':'Bayrampaşa'} (manuel atandı)</span>`
    : otomatikAtanmisMi
      ? `<span class="badge badge-success"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHtml(f.sube)} (Müşteri Master'dan otomatik)</span>`
      : `<span class="badge badge-warn"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Kontrol — VKN hiçbir müşteri master'da yok</span>`;

  return `
    <div class="sube-atama-blok">
      <div class="upload-section-label">Şube</div>
      <div class="sube-durum-etiket">${durumEtiketi}</div>
      <div class="sube-atama-grid">
        <button type="button" class="sube-atama-btn ${manuelAtanmisMi==='kesan'?'active':''}" data-sube="kesan">
          <i class="fa-solid fa-building" aria-hidden="true"></i> Keşan'a ata
        </button>
        <button type="button" class="sube-atama-btn ${manuelAtanmisMi==='bayrampasa'?'active':''}" data-sube="bayrampasa">
          <i class="fa-solid fa-building" aria-hidden="true"></i> Bayrampaşa'ya ata
        </button>
      </div>
      ${manuelAtanmisMi ? `<button type="button" class="manuel-durum-temizle" id="btnSubeAtamaTemizle"><i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Şube atamasını kaldır</button>` : ''}
      <div class="sube-atama-not">Bu VKN'ye ait tüm faturalar (geçmiş ve gelecek dönemler dahil) otomatik olarak seçilen şubeye düşer.</div>
      <button type="button" class="sube-atama-link" id="btnZincirVknEkle"><i class="fa-solid fa-link" aria-hidden="true"></i> Bu VKN'yi "zincir" olarak işaretle (VKN paylaşımlı marka)</button>
    </div>
  `;
}

const KAYNAK_ETIKET_TANIM = {
  logo: {label:'E-Fatura · Logo', icon:'fa-solid fa-file-invoice'},
  qnb: {label:'E-Fatura · QNB', icon:'fa-solid fa-file-invoice'},
  earsiv: {label:'E-Arşiv', icon:'fa-solid fa-box-archive'},
  netsis: {label:'Netsis', icon:'fa-solid fa-calculator'},
};
function kaynakEtiketiGetir(kaynakKey){
  return KAYNAK_ETIKET_TANIM[kaynakKey] || {label: kaynakKey || 'Bilinmiyor', icon:'fa-solid fa-circle-question'};
}

function faturaDetayModalAc(key){
  const f = state.rapor.faturalar.find(x=> x.faturaKey===key);
  if(!f) return;

  // KRİTİK DÜZELTME: Aynı ID'ye (faturaDetayOverlay) sahip birden fazla modal
  // document.body'e eklenebiliyordu — örneğin şube atama sonrası "overlay.remove();
  // faturaDetayModalAc(key);" akışında, bir önceki overlay her nedense kaldırılmadan
  // yeni bir tane eklenirse, iki (hatta daha fazla) overlay ÜST ÜSTE birikiyordu.
  // Bu da hem arka planın giderek karartılmasına (her overlay kendi yarı-saydam
  // katmanını ekliyor) hem de tıklamaların ARTIK EN ÜSTTEKİ overlay'e gitmesine ama
  // querySelector çağrılarının document.getElementById ile İLK (en eski, artık
  // görünmeyen) overlay'i bulup ona event listener bağlamasına yol açıyordu — yani
  // kullanıcı en üstteki (görünen) modaldaki butona bassa bile hiçbir şey olmuyordu.
  // Çözüm: yeni modal açmadan ÖNCE, varsa TÜM eski faturaDetayOverlay'leri temizle.
  document.querySelectorAll('#faturaDetayOverlay').forEach(eski=> eski.remove());

  const manuelTanim = f.manuelDurum ? manuelDurumTanimBul(f.manuelDurum) : null;
  const gercekDurum = f.manuelDurum ? f.orijinalDurum : f.durum;
  const gercekDurumEtiket = f.manuelDurum ? f.orijinalDurumEtiket : f.durumEtiket;

  const overlay = document.createElement('div');
  overlay.className = 'upload-overlay';
  overlay.id = 'faturaDetayOverlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="upload-modal" style="max-width:420px;">
      <div class="upload-modal-head">
        <div class="upload-modal-title">Fatura Detayı</div>
        <button type="button" class="upload-close" id="btnCloseFaturaDetay" aria-label="Kapat"><i class="fa-solid fa-xmark" aria-hidden="true"></i></button>
      </div>

      <div class="fd-hero">
        <div class="fd-hero-top">
          <div class="fd-hero-info">
            <div class="fd-hero-fno">${escapeHtml(f.faturaNo)}</div>
            <div class="fd-hero-unvan">${escapeHtml(f.gonderenUnvan)}</div>
          </div>
          <span class="badge ${durumBadgeClass(gercekDurum)}"><i class="${durumBadgeIcon(gercekDurum)}" aria-hidden="true"></i> ${escapeHtml(gercekDurumEtiket)}</span>
        </div>
        <div class="fd-hero-tutar">${fmtTL(f.yon==='netsis' ? f.netsisTutar : f.tutar)}</div>
      </div>

      <div class="fd-bilgi-grid">
        <div class="fd-bilgi-hucre">
          <div class="upload-section-label">VKN/TCKN</div>
          <div class="fd-bilgi-deger">${escapeHtml(String(f.vkn==null?'—':f.vkn))}</div>
        </div>
        <div class="fd-bilgi-hucre">
          <div class="upload-section-label">Kaynak</div>
          <div class="fd-bilgi-deger">${escapeHtml(kaynakEtiketiGetir(f.kaynak).label)}</div>
        </div>
      </div>

      ${manuelTanim ? `
        <div class="manuel-aktif-uyari">
          <i class="fa-solid fa-circle-info" aria-hidden="true"></i>
          Bu fatura manuel olarak "<strong>${escapeHtml(manuelTanim.label)}</strong>" işaretlendi ve genel bakışta <strong>${manuelTanim.key==='iptal_edildi' ? 'Reddedildi/İptal' : 'Eşleşti'}</strong> olarak sayılıyor.
        </div>
      ` : ''}

      <div class="fd-akis-blok">${subeAtamaBlokHtml(f)}</div>

      ${f.farkDetay ? `<div class="fd-akis-blok">${farkDetayHtml(f)}</div>` : ''}

      <div class="fd-akis-blok">
        <div class="upload-section-label">Manuel durum işaretle</div>
        <div class="manuel-durum-grid">
          ${MANUEL_DURUM_TANIM.map(d=>`
            <button type="button" class="manuel-durum-btn ${manuelTanim && manuelTanim.key===d.key ? 'active':''}" data-durum="${d.key}">
              <i class="${d.icon}" aria-hidden="true"></i> ${escapeHtml(d.label)}
            </button>
          `).join('')}
        </div>
        <button type="button" class="manuel-durum-temizle" id="btnManuelDurumTemizle" ${manuelTanim ? '' : 'style="display:none;"'}>
          <i class="fa-solid fa-rotate-left" aria-hidden="true"></i> Manuel durumu kaldır
        </button>
      </div>

      <div class="fd-akis-blok">
        <div class="upload-section-label">Not ekle</div>
        <textarea id="faturaNotAlani" class="fatura-not-alani" placeholder="Örn: KEF2026 nolu fatura ile iade edildi">${escapeHtml(f.not||'')}</textarea>
        ${f.notGuncellemeZamani ? `<div class="fatura-not-zaman">Son güncelleme: ${new Date(f.notGuncellemeZamani).toLocaleString('tr-TR')}</div>` : ''}
      </div>

      <button type="button" class="upload-build-btn" id="btnFaturaDetayKaydet">
        <i class="fa-solid fa-check" aria-hidden="true"></i> Kaydet
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelectorAll('.manuel-durum-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const zatenAktif = btn.classList.contains('active');
      overlay.querySelectorAll('.manuel-durum-btn').forEach(b=> b.classList.remove('active'));
      if(!zatenAktif) btn.classList.add('active');
      overlay.querySelector('#btnManuelDurumTemizle').style.display = overlay.querySelector('.manuel-durum-btn.active') ? '' : 'none';
    });
  });
  overlay.querySelector('#btnManuelDurumTemizle').addEventListener('click', ()=>{
    overlay.querySelectorAll('.manuel-durum-btn').forEach(b=> b.classList.remove('active'));
    overlay.querySelector('#btnManuelDurumTemizle').style.display = 'none';
  });

  // Şube atama butonları: tıklanınca ANINDA (Kaydet'e basmayı beklemeden) kalıcı olarak
  // yazılır ve rapor yeniden hesaplanıp modal güncel haliyle yeniden açılır — kullanıcı
  // atamanın hemen etkili olduğunu görsün.
  // NOT: fatura-sube-atama-btn (zincir VKN'ler için, faturaKey bazlı) ve normal
  // sube-atama-btn (VKN bazlı) AYRI seçicilerle ele alınır — birbirine karışmasın diye
  // :not(.fatura-sube-atama-btn) ile normal VKN bazlı butonlar filtrelenir.
  //
  // ÖNEMLİ: Zincir VKN'ler (örn. Migros, yüzlerce fatura) için computeRapor +
  // saveRaporToStorage (RTDB yazımı) BİR KAÇ SANİYE sürebilir. Bu süre boyunca
  // kullanıcı "tepki almıyorum" hissiyle tekrar tekrar tıklarsa, her tıklama yeni bir
  // faturaDetayModalAc çağrısı + potansiyel modal üst üste binmesine yol açabiliyordu.
  // Çözüm: tıklanan modalın TÜM butonlarını hemen devre dışı bırakıp "İşleniyor…"
  // göstergesi ekliyoruz — işlem bitene kadar hiçbir buton tekrar tıklanamaz.
  function modalButonlariniKilitle(){
    overlay.querySelectorAll('button').forEach(b=> b.disabled = true);
    overlay.style.opacity = '0.6';
    overlay.style.pointerEvents = 'none';
  }

  async function subeIslemiCalistirVeYenidenAc(islemFn){
    modalButonlariniKilitle();
    try{
      await islemFn();
      await subeAtamasiSonrasiYenidenHesapla();
    }catch(hata){
      // Beklenmeyen bir hata (örn. depolama erişim sorunu, ağ hatası) — işlemi sessizce
      // yutmuyoruz, kullanıcıya haber veriyoruz. finally bloğu yine de modalı güncel
      // state ile yeniden açacak (atama muhtemelen yerel state'e işlenmiştir bile olsa
      // kalıcı kayıt/senkron başarısız olmuş olabilir).
      console.error('Şube/zincir atama işlemi sırasında hata:', hata);
      if(typeof toastGoster === 'function') toastGoster('İşlem kaydedilirken bir sorun oluştu, tekrar deneyin', 'hata');
    }finally{
      overlay.remove();
      faturaDetayModalAc(key); // aynı fatura, güncel şube bilgisiyle yeniden aç
    }
  }

  overlay.querySelectorAll('.sube-atama-btn:not(.fatura-sube-atama-btn)').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const secilenGrup = btn.dataset.sube;
      const zatenBuGrupMu = vknSubesiAtanmisMi(f.vkn) === secilenGrup;
      subeIslemiCalistirVeYenidenAc(()=> vknSubesiniAta(f.vkn, zatenBuGrupMu ? null : secilenGrup)); // tekrar tıklayınca kaldır (toggle)
    });
  });
  const subeTemizleBtn = overlay.querySelector('#btnSubeAtamaTemizle');
  if(subeTemizleBtn){
    subeTemizleBtn.addEventListener('click', ()=>{
      subeIslemiCalistirVeYenidenAc(()=> vknSubesiniAta(f.vkn, null));
    });
  }

  // Fatura bazlı şube atama butonları (SADECE zincir VKN'ler için gösterilir) —
  // faturaKey'e göre atanır, VKN'ye değil; aynı VKN'nin başka faturalarını etkilemez.
  overlay.querySelectorAll('.fatura-sube-atama-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const secilenGrup = btn.dataset.sube;
      const zatenBuGrupMu = faturaSubesiAtanmisMi(f.faturaKey) === secilenGrup;
      subeIslemiCalistirVeYenidenAc(()=> faturaSubesiniAta(f.faturaKey, zatenBuGrupMu ? null : secilenGrup));
    });
  });
  const faturaSubeTemizleBtn = overlay.querySelector('#btnFaturaSubeAtamaTemizle');
  if(faturaSubeTemizleBtn){
    faturaSubeTemizleBtn.addEventListener('click', ()=>{
      subeIslemiCalistirVeYenidenAc(()=> faturaSubesiniAta(f.faturaKey, null));
    });
  }

  // Zincir VKN listesine ekleme/çıkarma — Kontrol grubunda görünen "Bu VKN'yi zincir
  // olarak işaretle" ve zincir bloğundaki "listesinden çıkar" butonları.
  const zincirEkleBtn = overlay.querySelector('#btnZincirVknEkle');
  if(zincirEkleBtn){
    zincirEkleBtn.addEventListener('click', ()=>{
      subeIslemiCalistirVeYenidenAc(()=> zincirVknEkle(f.vkn));
    });
  }
  const zincirCikarBtn = overlay.querySelector('#btnZincirVknCikar');
  if(zincirCikarBtn){
    zincirCikarBtn.addEventListener('click', ()=>{
      subeIslemiCalistirVeYenidenAc(()=> zincirVknCikar(f.vkn));
    });
  }

  // ÖNERİ 7: Esc ile kapatma. Modal kaldırıldığında dinleyici de sökülür (sızıntı olmasın).
  function modalKapat(){
    overlay.remove();
    document.removeEventListener('keydown', escDinle);
  }
  function escDinle(e){ if(e.key==='Escape') modalKapat(); }
  document.addEventListener('keydown', escDinle);

  overlay.querySelector('#btnFaturaDetayKaydet').addEventListener('click', ()=> faturaDetayKaydet(key, overlay, modalKapat));
  overlay.querySelector('#btnCloseFaturaDetay').addEventListener('click', modalKapat);
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) modalKapat(); });
}

// Şube ataması değiştikten sonra raporu yeniden hesaplayıp ekranı günceller — bu bir
// "arşivleme" değil, canlı raporun anlık yeniden hesabıdır (arşiv, bir sonraki
// "Raporu Oluştur" çağrısında bu güncel şube bilgisiyle otomatik güncellenir).
async function subeAtamasiSonrasiYenidenHesapla(){
  state.rapor = computeRapor(state.kaynaklar, state.manuel, state.subeAtamalari, state.zincirVknListesi, state.faturaSubeAtamalari);
  await saveRaporToStorage();
  renderKPIs();
  renderGroupTabs();
  renderGroupSections();
}
