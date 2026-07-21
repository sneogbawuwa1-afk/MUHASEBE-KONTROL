'use strict';

const EFES_VKN = normVKN('3250032635');

const TUTAR_TOLERANS_VARSAYILAN = 1;
let TUTAR_TOLERANS = TUTAR_TOLERANS_VARSAYILAN;

function tutarToleransiAyarla(deger){
  const n = Number(deger);
  TUTAR_TOLERANS = (isNaN(n) || n < 0) ? TUTAR_TOLERANS_VARSAYILAN : n;
}

function belirleSube(faturaVkn, faturaNo, efesKesanMi, efesFaturaNoSeti, kesanVknSeti, bayrampasaVknSeti, manuelSubeAtamalari, zincirVknSeti){
  const vkn = normVKN(faturaVkn);

  // ZİNCİR VKN İSTİSNASI: Migros gibi Türkiye genelinde tüm şubeleri aynı VKN'yi
  // kullanan markalar için — bu VKN Müşteri Master'da bulunsa, hatta manuel VKN
  // ataması yapılmış olsa bile HER ZAMAN "Kontrol" grubuna düşer (en yüksek öncelik,
  // manuel VKN atamasından bile önce kontrol edilir). Kullanıcı bu markanın her
  // faturasını KENDİ BAŞINA (VKN'ye değil, o faturanın kendisine göre) elle
  // Keşan/Bayrampaşa'ya atar — bkz. computeRapor'daki faturaSubeAtamalari.
  if(zincirVknSeti && zincirVknSeti.has(vkn)){
    return {grup:'kontrol', alt:'Kontrol'};
  }

  // MANUEL ŞUBE ATAMASI: kullanıcı bu VKN'yi elle Keşan/Bayrampaşa'ya atamışsa, bu her
  // zaman en yüksek önceliğe sahiptir — Efes özel mantığından ve müşteri master
  // setlerinden ÖNCE kontrol edilir. VKN bazında kalıcıdır: hangi dönemde/ayda olursa
  // olsun bu VKN'ye ait TÜM faturalar otomatik olarak atanan şubeye düşer.
  if(manuelSubeAtamalari && manuelSubeAtamalari.has(vkn)){
    const atanmisGrup = manuelSubeAtamalari.get(vkn);
    if(atanmisGrup === 'kesan') return {grup:'kesan', alt:'Keşan (manuel)'};
    if(atanmisGrup === 'bayrampasa') return {grup:'bayrampasa', alt:'Bayrampaşa (manuel)'};
  }

  if(vkn === EFES_VKN){

    if(efesKesanMi === null) return {grup:'kontrol', alt:'Kontrol'};
    const faturaNoNorm = String(faturaNo||'').trim().toUpperCase();
    const ekstredeVarMi = efesFaturaNoSeti.has(faturaNoNorm);

    const buFaturaKesanMi = ekstredeVarMi ? efesKesanMi : !efesKesanMi;
    return buFaturaKesanMi ? {grup:'kesan', alt:'Keşan Efes'} : {grup:'bayrampasa', alt:'Bayrampaşa Efes'};
  }
  if(kesanVknSeti.has(vkn)) return {grup:'kesan', alt:'Keşan'};
  if(bayrampasaVknSeti.has(vkn)) return {grup:'bayrampasa', alt:'Bayrampaşa'};
  return {grup:'kontrol', alt:'Kontrol'};
}

function computeRapor(kaynaklar, manuel, subeAtamalari, zincirVknListesi, faturaSubeAtamalari){
  manuel = manuel || {};
  // subeAtamalari: {vkn(normalize): 'kesan'|'bayrampasa'} kalıcı VKN->şube kararları.
  // Map bekleniyor; obje verilirse (örn. IndexedDB'den plain object dönmüşse) Map'e çevrilir.
  // NOT: `instanceof Map` yerine duck-typing kullanılıyor — farklı JS realm'lerinden
  // (iframe, vm modülü, vb.) gelen Map nesneleri instanceof kontrolünden geçemeyebilir.
  const mapGibiMi = subeAtamalari && typeof subeAtamalari.get === 'function' && typeof subeAtamalari.has === 'function';
  const manuelSubeAtamalari = mapGibiMi
    ? subeAtamalari
    : new Map(Object.entries(subeAtamalari || {}));

  // zincirVknListesi: Set<vkn> ya da dizi/obje olarak gelebilir (senkron katmanından
  // dönen halinden bağımsız olarak) — duck-typing ile Set'e normalize ediyoruz.
  const zincirSetGibiMi = zincirVknListesi && typeof zincirVknListesi.has === 'function';
  const zincirVknSeti = zincirSetGibiMi ? zincirVknListesi : new Set(Array.isArray(zincirVknListesi) ? zincirVknListesi : []);

  // faturaSubeAtamalari: Map<faturaKey, 'kesan'|'bayrampasa'> — VKN'den BAĞIMSIZ,
  // sadece o faturaya özel geçici atama (bkz. state.faturaSubeAtamalari tanımı).
  const faturaSubeMapGibiMi = faturaSubeAtamalari && typeof faturaSubeAtamalari.get === 'function';
  const faturaSubeAtamalariMap = faturaSubeMapGibiMi
    ? faturaSubeAtamalari
    : new Map(Object.entries(faturaSubeAtamalari || {}));

  const logoRows = kaynaklar.efaturaLogo ? parseLogoRows(kaynaklar.efaturaLogo.rows) : [];
  const qnbRows = kaynaklar.efaturaQnb ? parseQnbRows(kaynaklar.efaturaQnb.rows) : [];
  const earsivRows = kaynaklar.earsiv ? parseEarsivRows(kaynaklar.earsiv.rows) : [];
  const entegratorRows = [...logoRows, ...qnbRows, ...earsivRows];

  function belgeNoEfaturaFormatindaMi(belgeNo){
    return /[A-Za-z]/.test(String(belgeNo||''));
  }

  function cariMuhtelifMi(cariIsim){
    return /MUHTELİF|MUHTELIF/i.test(String(cariIsim||''));
  }
  const netsisRowsHam = kaynaklar.netsis ? parseNetsisRows(kaynaklar.netsis.rows) : [];
  const netsisRows = netsisRowsHam.filter(r=> belgeNoEfaturaFormatindaMi(r.belgeNo) && !cariMuhtelifMi(r.cariIsim));
  const netsisIdx = new Map();
  const netsisByVkn = new Map();
  netsisRows.forEach(r=>{
    const key = matchKey(r.vkn, r.belgeNo);
    if(!netsisIdx.has(key)) netsisIdx.set(key, r);
    const vknKey = normVKN(r.vkn);
    if(!netsisByVkn.has(vknKey)) netsisByVkn.set(vknKey, []);
    netsisByVkn.get(vknKey).push(r);
  });

  function yakinNetsisBul(vkn, faturaNo){
    const adaylar = netsisByVkn.get(normVKN(vkn)) || [];
    return adaylar.find(r=> faturaNoYakinMi(faturaNo, r.belgeNo)) || null;
  }

  // CARİ KODU BULMA ÖNCELİK SIRASI:
  //   1) Keşan Müşteri Master ('Müşteri' sütunu)
  //   2) Bayrampaşa Müşteri Master ('Merkez Kodu' sütunu)
  //   3) Netsis kayıtları (VKN eşleşmesiyle en sık geçen kod) — SADECE Master'da
  //      hiç bulunamazsa buraya düşülür.
  // Master'a öncelik verilmesinin sebebi: Netsis'teki VKN-bazlı gruplama, VKN'si boş/
  // eksik olan farklı müşterileri yanlışlıkla aynı grupta toplayıp birbirlerinin cari
  // kodunu vermelerine yol açabiliyordu (özellikle çok kayıtlı Netsis dosyalarında,
  // cihazdan cihaza farklı sıralama/gruplama nedeniyle TUTARSIZ sonuçlar verebiliyordu).
  // Master dosyasındaki eşleşme VKN'ye göre net ve tekildir, bu riski taşımaz.
  function vknIleCariKoduBulNetsisten(vkn){
    const adaylar = netsisByVkn.get(normVKN(vkn)) || [];
    if(!adaylar.length) return '';
    const sayac = new Map();
    adaylar.forEach(r=>{
      const kod = String(r.cariKodu||'').trim();
      if(!kod) return;
      sayac.set(kod, (sayac.get(kod)||0)+1);
    });
    if(!sayac.size) return '';
    let enSikKod = '', enSikSayi = -1;
    sayac.forEach((sayi, kod)=>{
      if(sayi > enSikSayi){ enSikSayi = sayi; enSikKod = kod; }
    });
    return enSikKod;
  }

  const kesanVknSeti = kaynaklar.musteriKesan ? parseMusteriMasterVknSeti(kaynaklar.musteriKesan.rows) : new Set();
  const bayrampasaVknSeti = kaynaklar.musteriBayrampasa ? parseMusteriMasterVknSeti(kaynaklar.musteriBayrampasa.rows) : new Set();
  const efesKesanMi = kaynaklar.efesEkstre ? efesEkstreKesanMi(kaynaklar.efesEkstre.rows) : null;
  const efesFaturaNoSeti = kaynaklar.efesEkstre ? efesEkstreFaturaNoSeti(kaynaklar.efesEkstre.rows) : new Set();

  // MÜŞTERİ MASTER CARİ KODU HARİTALARI: Keşan ve Bayrampaşa Master dosyaları cari
  // kodunu FARKLI sütunlarda taşıyor (bkz. js/02-veri-yukleme.js açıklaması). Cari
  // kodu artık ÖNCELİKLE buradan okunuyor — Netsis'e (VKN eşleşmesiyle en sık geçen
  // kod) sadece Master'da hiç bulunamazsa düşülüyor. Bu, VKN'si boş/eksik olan farklı
  // müşterilerin Netsis tarafında yanlışlıkla aynı gruba düşüp BİRBİRLERİNİN cari
  // kodunu almasını (bildirilen "cari kodu başka kişiye ait çıkıyor" sorunu) engeller.
  const kesanCariKoduHaritasi = kaynaklar.musteriKesan ? parseMusteriMasterCariKoduHaritasi(kaynaklar.musteriKesan.rows, 'Müşteri') : new Map();
  const bayrampasaCariKoduHaritasi = kaynaklar.musteriBayrampasa ? parseMusteriMasterCariKoduHaritasi(kaynaklar.musteriBayrampasa.rows, 'Merkez Kodu') : new Map();

  function vknIleCariKoduBul(vkn){
    const normalizeVkn = normVKN(vkn);
    if(kesanCariKoduHaritasi.has(normalizeVkn)) return kesanCariKoduHaritasi.get(normalizeVkn);
    if(bayrampasaCariKoduHaritasi.has(normalizeVkn)) return bayrampasaCariKoduHaritasi.get(normalizeVkn);
    return vknIleCariKoduBulNetsisten(vkn);
  }

  const subeTayiniYap = (vkn, faturaNo)=> belirleSube(vkn, faturaNo, efesKesanMi, efesFaturaNoSeti, kesanVknSeti, bayrampasaVknSeti, manuelSubeAtamalari, zincirVknSeti);

  // Fatura bazlı geçici şube ataması: subeTayiniYap "kontrol" dediyse ama bu SPESİFİK
  // faturaKey için kullanıcı elle bir şube atamışsa, o ata uygulanır. VKN bazlı
  // subeAtamalari'ndan farklı olarak burası SADECE bu faturaya özeldir — aynı VKN'nin
  // başka bir faturasını etkilemez.
  function subeTayininiFaturayaGoreUygula(sube, faturaKey){
    if(sube.grup !== 'kontrol') return sube; // sadece Kontrol'e düşenler için anlamlı
    const atanmisGrup = faturaSubeAtamalariMap.get(faturaKey);
    if(atanmisGrup === 'kesan') return {grup:'kesan', alt:'Keşan (bu ay, elle)'};
    if(atanmisGrup === 'bayrampasa') return {grup:'bayrampasa', alt:'Bayrampaşa (bu ay, elle)'};
    return sube;
  }

  // Normalleşen manuel işaretler: kullanıcı bir faturayı manuel "eslesti" işaretlemişti
  // (o an Netsis'te yoktu) ama yeni yüklenen Netsis verisinde fatura ARTIK GERÇEKTEN
  // bulunuyor. Bu durumda manuel etiketi taşımanın anlamı kalmaz — normal/gerçek "Eşleşti"
  // durumuna döner. Not (varsa) korunur, sadece durum etiketi/manuel bayrağı temizlenir.
  // computeRapor saf kalması için burada state.manuel'i DEĞİŞTİRMİYORUZ — sadece hangi
  // anahtarların normalleştiği listeleniyor; kalıcı temizleme çağıran taraf (raporuOlustur)
  // tarafından normallesenManuelIsaretler listesine bakılarak yapılır.
  const normallesenManuelIsaretler = [];

  function manuelDurumUygula(satir, manuelKayit){
    const manuelDurumKey = manuelKayit ? manuelKayit.durum : null;

    // "eslesti" manuel işareti + gerçek durum zaten "eslesti" => manuel işaret gereksiz,
    // normalleştir (yalnızca iade_kesilecek için bu otomatik kaldırma YAPILMAZ — o kasıtlı
    // bir iş kararıdır, gerçek durumdan bağımsız kullanıcı tarafından kaldırılmalı).
    if(manuelDurumKey === 'eslesti' && satir.durum === 'eslesti'){
      normallesenManuelIsaretler.push(satir.faturaKey);
      return {
        ...satir,
        orijinalDurum: satir.durum,
        orijinalDurumEtiket: satir.durumEtiket,
        manuelDurum: null,
        not: manuelKayit.not || '',
        notGuncellemeZamani: manuelKayit.notGuncellemeZamani || null,
      };
    }

    if(manuelDurumKey === 'eslesti' || manuelDurumKey === 'iade_kesilecek'){
      return {
        ...satir,
        orijinalDurum: satir.durum,
        orijinalDurumEtiket: satir.durumEtiket,
        durum: 'eslesti',
        durumEtiket: manuelDurumKey === 'iade_kesilecek' ? 'Eşleşti (İade kesilecek)' : 'Eşleşti (Manuel)',
        manuelDurum: manuelDurumKey,
        not: manuelKayit.not || '',
        notGuncellemeZamani: manuelKayit.notGuncellemeZamani || null,
      };
    }

    // "iptal_edildi": kullanıcı bu faturayı elle iptal/reddedildi olarak işaretledi —
    // faturanın GERÇEK durumu ne olursa olsun (eşleşti, işlenmemiş, fark vb.) artık
    // "red" (Reddedildi/İptal) sayılır ve KPI'da o kategoriye düşer. redIptal alanı
    // Excel'den otomatik gelen iptal bilgisiyle aynı sonucu üretir ama burada kullanıcı
    // kararı olduğu için ayrı bir manuel işaret olarak saklanır (orijinal durum korunur).
    if(manuelDurumKey === 'iptal_edildi'){
      return {
        ...satir,
        orijinalDurum: satir.durum,
        orijinalDurumEtiket: satir.durumEtiket,
        durum: 'red',
        durumEtiket: 'Reddedildi/İptal (Manuel)',
        manuelDurum: manuelDurumKey,
        not: manuelKayit.not || '',
        notGuncellemeZamani: manuelKayit.notGuncellemeZamani || null,
      };
    }
    return {
      ...satir,
      orijinalDurum: satir.durum,
      orijinalDurumEtiket: satir.durumEtiket,
      manuelDurum: null,
      not: manuelKayit ? manuelKayit.not : '',
      notGuncellemeZamani: manuelKayit ? manuelKayit.notGuncellemeZamani : null,
    };
  }

  const kullanilanNetsisKey = new Set();

  const faturalar = entegratorRows.map(f=>{

    const vknAdaylari = (f.vknAdaylari && f.vknAdaylari.length) ? f.vknAdaylari : [f.vkn];

    let netsisEs = null, eslesmeKey = null;
    for(const vknAday of vknAdaylari){
      const key = matchKey(vknAday, f.faturaNo);
      const es = netsisIdx.get(key);
      if(es){ netsisEs = es; eslesmeKey = key; break; }
    }
    if(!netsisEs){

      for(const vknAday of vknAdaylari){
        const yakin = yakinNetsisBul(vknAday, f.faturaNo);
        if(yakin){ netsisEs = yakin; eslesmeKey = matchKey(yakin.vkn, yakin.belgeNo); break; }
      }
    }

    let durum, durumEtiket, farkDetay = null;
    if(netsisEs){
      kullanilanNetsisKey.add(eslesmeKey);
      const kdvKontrolVarMi = f.kdv != null;
      const tutarFarkTutari = f.tutar - netsisEs.tutar;
      const kdvFarkTutari = kdvKontrolVarMi ? (f.kdv - netsisEs.kdv) : 0;
      const tutarFarkVar = Math.abs(tutarFarkTutari) > TUTAR_TOLERANS;
      const kdvFarkVar = kdvKontrolVarMi && Math.abs(kdvFarkTutari) > TUTAR_TOLERANS;
      if(tutarFarkVar || kdvFarkVar){
        durum = 'fark'; durumEtiket = 'Tutar farkı';
        farkDetay = {
          tutarFarkVar, kdvFarkVar, kdvKontrolVarMi,
          entegratorTutar: f.tutar, netsisTutar: netsisEs.tutar, tutarFarkTutari,
          entegratorKdv: f.kdv, netsisKdv: netsisEs.kdv, kdvFarkTutari,
        };
      }else{
        durum = 'eslesti'; durumEtiket = 'Eşleşti';
      }
    }else if(f.redIptal){
      durum = 'red'; durumEtiket = 'Reddedildi/İptal';
    }else{

      durum = 'islenmemis'; durumEtiket = 'Netsis\'te bulunamadı';
    }

    const sube_ilk = (f.vkn === '' || f.vkn == null)
      ? {grup:'kontrol', alt:'Kontrol'}
      : subeTayiniYap(f.vkn, f.faturaNo);

    const anahtar = matchKey(f.vkn, f.faturaNo);
    const sube = subeTayininiFaturayaGoreUygula(sube_ilk, anahtar);
    const manuelKayit = manuel[anahtar] || null;

    // Cari kodu: önce tam fatura eşleşmesinden (netsisEs), yoksa VKN bazlı eşleşmeyle bulunur.
    const cariKodu = netsisEs && netsisEs.cariKodu ? netsisEs.cariKodu : vknIleCariKoduBul(f.vkn);

    const satirHam = {
      ...f,
      durum, durumEtiket, farkDetay,
      sube: sube.alt, subeGrup: sube.grup,
      netsisTutar: netsisEs ? netsisEs.tutar : null,
      netsisKdv: netsisEs ? netsisEs.kdv : null,
      cariKodu,
      yon: 'entegrator',
      faturaKey: anahtar,
    };

    return manuelDurumUygula(satirHam, manuelKayit);
  });

  const netsisEslesmeyen = netsisRows
    .map(r=>({r, key: matchKey(r.vkn, r.belgeNo)}))
    .filter(x=> !kullanilanNetsisKey.has(x.key))
    .map(({r, key})=>{
      const sube_ilk = subeTayiniYap(r.vkn, r.belgeNo);
      const sube = subeTayininiFaturayaGoreUygula(sube_ilk, key);
      const manuelKayit = manuel[key] || null;
      const satirHam = {
        vkn: r.vkn,
        faturaNo: r.belgeNo,
        faturaTarihi: r.tarih,
        tutar: r.tutar,
        kdv: r.kdv,
        gonderenUnvan: r.cariIsim,
        cariKodu: r.cariKodu || '',
        redIptal: false,
        kaynak: 'netsis',
        durum: 'entegratorde_yok',
        durumEtiket: 'Entegratörde bulunamadı',
        farkDetay: null,
        sube: sube.alt, subeGrup: sube.grup,
        netsisTutar: r.tutar,
        netsisKdv: r.kdv,
        yon: 'netsis',
        faturaKey: key,
      };
      return manuelDurumUygula(satirHam, manuelKayit);
    });

  const tumSatirlar = [...faturalar, ...netsisEslesmeyen];

  // YETİM MANUEL İŞARET TESPİTİ: state.manuel içinde kayıtlı olup bu raporun HİÇBİR
  // satırıyla eşleşmeyen (faturaKey karşılığı bulunamayan) manuel durum/not kayıtları.
  // Ham veri yeniden yüklendiğinde fatura no formatı değişmişse manuel emek "yetim" kalır;
  // bunları toplayıp arayüzde uyarı olarak gösteririz (kullanıcı emeği sessizce kaybolmasın).
  const mevcutKeyler = new Set(tumSatirlar.map(f=> f.faturaKey));
  const yetimManuel = Object.keys(manuel)
    .filter(k=>{
      const m = manuel[k];
      const doluMu = m && (m.durum || (m.not && m.not.trim()));
      return doluMu && !mevcutKeyler.has(k);
    })
    .map(k=>({ faturaKey: k, durum: manuel[k].durum || null, not: manuel[k].not || '' }));

  const kpi = {
    toplam: faturalar.length,
    eslesti: faturalar.filter(f=>f.durum==='eslesti').length,
    islenmemis: faturalar.filter(f=>f.durum==='islenmemis').length,
    entegratordeYok: netsisEslesmeyen.length,
    fark: faturalar.filter(f=>f.durum==='fark').length,
    red: faturalar.filter(f=>f.durum==='red').length,
    kontrol: tumSatirlar.filter(f=>f.subeGrup==='kontrol').length,
    notlu: tumSatirlar.filter(f=> f.not && f.not.trim()).length,
    manuel: tumSatirlar.filter(f=> f.manuelDurum).length,
    iadeKesilecek: tumSatirlar.filter(f=> f.manuelDurum==='iade_kesilecek').length,
  };

  const gruplar = {
    kesan: tumSatirlar.filter(f=>f.subeGrup==='kesan'),
    bayrampasa: tumSatirlar.filter(f=>f.subeGrup==='bayrampasa'),
    kontrol: tumSatirlar.filter(f=>f.subeGrup==='kontrol'),
    notlu: tumSatirlar.filter(f=> f.not && f.not.trim()),
  };

  return {faturalar: tumSatirlar, kpi, gruplar, efesKesanMi, yetimManuel, normallesenManuelIsaretler};
}
