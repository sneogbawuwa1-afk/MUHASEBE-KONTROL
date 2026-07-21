'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const kod01 = fs.readFileSync(path.join(__dirname, '..', 'js', '01-cekirdek.js'), 'utf8');
const kod02 = fs.readFileSync(path.join(__dirname, '..', 'js', '02-veri-yukleme.js'), 'utf8');
const kod03 = fs.readFileSync(path.join(__dirname, '..', 'js', '03-eslestirme.js'), 'utf8');
const kod07 = fs.readFileSync(path.join(__dirname, '..', 'js', '07-donem-arsivi.js'), 'utf8');
const kod08 = fs.readFileSync(path.join(__dirname, '..', 'js', '08-senkron-katmani.js'), 'utf8');
const kod09 = fs.readFileSync(path.join(__dirname, '..', 'js', '09-firebase.js'), 'utf8');

const sahteDocument = {
  getElementById: ()=> null,
  createElement: ()=> ({ classList:{add(){}}, style:{}, appendChild(){}, addEventListener(){}, querySelector(){ return null; } }),
  body: { prepend(){} },
};
const sahteWindow = { indexedDB: {}, localStorage: { getItem:()=>null, setItem(){}, removeItem(){} } };

const context = { document: sahteDocument, window: sahteWindow, indexedDB: {} };
const vm = require('vm');
vm.createContext(context);
vm.runInContext(kod01, context);
vm.runInContext(kod02, context);
vm.runInContext(kod03, context);
vm.runInContext(kod07, context);
vm.runInContext(kod08, context);
vm.runInContext(kod09, context);

const {
  normVKN, parseFaturaNo, digitsYakinMi, faturaNoYakinMi, matchKey, toNumber,
  belirleSube, computeRapor, excelDateToJS,
  donemIdUret, donemEtiketUret, raporunAitOlduguDonem, netsisAnahtarKumesiCikar,
  donemKarsilastirmaHesapla, gunBazliBosluklariHesapla, donemToplamOzetiHesapla,
  vknSubesiAtanmisMi, donemFarkiAySayisi, donemOtomatikYazilabilirMi,
  donemGuncellemeAnaliziniYap, donemOnayiUygula, donemeAitSatirlariFiltrele,
  derinDateTemizle, derinAnahtarKodla, derinAnahtarKodCoz,
} = context;

// NOT: `const state = {...}` gibi top-level bindingler Node'un vm.runInContext'inde
// contextify edilen objeye YANSIMAZ (yalnızca `var` yansır) — bu yüzden state'e her
// erişimde doğrudan context üzerinden script çalıştırıyoruz.
function stateDonemleriniAyarla(donemler){
  context.__test_donemler = donemler;
  vm.runInContext('state.donemler = __test_donemler;', context);
}

function stateSubeAtamalariniAyarla(girdiler){ // girdiler: [[vkn, grup], ...] dizisi
  context.__test_sube_atamalari = new Map(girdiler);
  vm.runInContext('state.subeAtamalari = __test_sube_atamalari;', context);
}

let gecen = 0, toplam = 0;
let asyncTestZinciri = Promise.resolve(); // async testler SIRALI çalışsın diye zincirleniyor
let zincirdeBekleyenVar = false;
function test(ad, fn){
  toplam++;
  // ÖNEMLİ: fn()'i burada HEMEN çağırmıyoruz. Bir önceki async testin zincirdeki işi
  // tamamlanmadan bu testin fn()'i çağrılırsa, ikisi aynı anda state.donemler gibi paylaşılan
  // state'i değiştirebilir (senkron kısımları iç içe girebilir). Bunun yerine fn'i zincire
  // bir adım olarak ekliyoruz: zincir bu noktaya geldiğinde fn() çağrılır, sonucu senkron mu
  // async mı diye bakılır, ona göre işlenir. Testler tanımlandığı SIRAYLA çalışmaya devam eder.
  asyncTestZinciri = asyncTestZinciri.then(()=>{
    let sonuc;
    try{
      sonuc = fn();
    }catch(err){
      console.log(`FAIL  ${ad}`);
      console.log(`      ${err.message}`);
      return;
    }
    if(sonuc && typeof sonuc.then === 'function'){
      return sonuc.then(()=>{
        gecen++;
        console.log(`  OK  ${ad}`);
      }).catch((err)=>{
        console.log(`FAIL  ${ad}`);
        console.log(`      ${err.message}`);
      });
    }
    gecen++;
    console.log(`  OK  ${ad}`);
  });
}

// console.log çağrılarını da (bölüm başlıkları için) zincire dahil ediyoruz — aksi halde
// tüm başlıklar en başta, tüm test sonuçları en sonda basılır (çünkü testler artık
// microtask zincirinde çalışıyor). Bu fonksiyon çıktı sırasının doğru olmasını sağlar.
function baslik(metin){
  asyncTestZinciri = asyncTestZinciri.then(()=> console.log(metin));
}

baslik('normVKN');
test('baştaki sıfırları temizler', ()=>{
  assert.strictEqual(normVKN('0012345678'), '12345678');
});
test('nokta/boşluk gibi karakterleri temizler', ()=>{
  assert.strictEqual(normVKN('325.003.2635'), '3250032635');
});
test('boş girdi için boş string döner', ()=>{
  assert.strictEqual(normVKN(null), '');
  assert.strictEqual(normVKN(''), '');
});
test('tamamı sıfırsa "0" döner', ()=>{
  assert.strictEqual(normVKN('000'), '0');
});

baslik('\nparseFaturaNo');
test('standart ES + rakam formatını ayrıştırır', ()=>{
  const r = parseFaturaNo('ES22026000020732');
  assert.strictEqual(r.prefix, 'ES');
  assert.strictEqual(r.digits, '22026000020732');
  assert.strictEqual(r.ayristirilamadi, false);
});
test('küçük harfi büyük harfe çevirir', ()=>{
  const r = parseFaturaNo('es2026123');
  assert.strictEqual(r.prefix, 'ES');
});
test('uymayan formatta ayristirilamadi=true döner', ()=>{
  const r = parseFaturaNo('2026-000-123');
  assert.strictEqual(r.ayristirilamadi, true);
});

baslik('\ndigitsYakinMi (tek haneli sıfır kayması toleransı)');
test('aynı rakamlar true döner', ()=>{
  assert.strictEqual(digitsYakinMi('020732', '020732'), true);
});
test('ortaya eklenen tek sıfır true döner', ()=>{
  assert.strictEqual(digitsYakinMi('20732', '020732'), true);
});
test('iki haneli fark false döner', ()=>{
  assert.strictEqual(digitsYakinMi('732', '020732'), false);
});
test('aynı uzunlukta farklı rakamlar false döner', ()=>{
  assert.strictEqual(digitsYakinMi('020732', '020733'), false);
});
test('sona eklenen tek sıfır da true döner', ()=>{
  assert.strictEqual(digitsYakinMi('2073', '20730'), true);
});
test('boş ve tek karakter sınır durumu', ()=>{
  assert.strictEqual(digitsYakinMi('', '0'), true);
  assert.strictEqual(digitsYakinMi('', '5'), false);
});

baslik('\nfaturaNoYakinMi');
test('prefix farklıysa false döner', ()=>{
  assert.strictEqual(faturaNoYakinMi('ES2026123', 'FA2026123'), false);
});
test('prefix aynı, rakamlar sıfır kaymasıyla yakınsa true döner', ()=>{
  assert.strictEqual(faturaNoYakinMi('ES2026000020732', 'ES202600020732'), true);
});

baslik('\nmatchKey');
test('vkn ve fatura no birlikte anahtar üretir', ()=>{
  const k1 = matchKey('3250032635', 'ES22026000020732');
  const k2 = matchKey('03250032635', 'es22026000020732');
  assert.strictEqual(k1, k2);
});

baslik('\ntoNumber');
test('virgüllü ondalık TL formatını doğru çevirir', ()=>{
  assert.strictEqual(toNumber('32.500,00'), 32500);
});
test('sadece nokta olan ondalığı doğru çevirir', ()=>{
  assert.strictEqual(toNumber('1589.23'), 1589.23);
});
test('binlik nokta ayracını doğru çevirir', ()=>{
  assert.strictEqual(toNumber('1.589'), 1589);
});
test('boş/null için 0 döner', ()=>{
  assert.strictEqual(toNumber(null), 0);
  assert.strictEqual(toNumber(''), 0);
});
test('ISO ondalık "67200.00" 100 katına ÇIKMAZ (regresyon)', ()=>{
  // QNB TUTAR alanı ISO metin gelince nokta binlik sanılıp 6720000 olmamalı.
  assert.strictEqual(toNumber('67200.00'), 67200);
});
test('çok basamaklı binlik grupları doğru çevrilir', ()=>{
  assert.strictEqual(toNumber('1.234.567'), 1234567);
});
test('zaten sayı olan değeri aynen döndürür', ()=>{
  assert.strictEqual(toNumber(1589.23), 1589.23);
});

baslik('\nexcelDateToJS (tarih güvenilirliği)');
test('YYYYMMDD (QNB) formatını doğru çevirir', ()=>{
  const d = excelDateToJS('20260630');
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 5); // Haziran
  assert.strictEqual(d.getDate(), 30);
});
test('GG.AA.YYYY metnini doğru çevirir', ()=>{
  const d = excelDateToJS('30.06.2026');
  assert.strictEqual(d.getMonth(), 5);
  assert.strictEqual(d.getDate(), 30);
});
test('ISO YYYY-AA-GG metnini doğru çevirir', ()=>{
  const d = excelDateToJS('2026-06-30');
  assert.strictEqual(d.getMonth(), 5);
  assert.strictEqual(d.getDate(), 30);
});
test('belirsiz/tanınmayan format null döner (ham Date kullanılmaz)', ()=>{
  assert.strictEqual(excelDateToJS('30 Haziran'), null);
  assert.strictEqual(excelDateToJS('abc'), null);
});
test('boş değer null döner', ()=>{
  assert.strictEqual(excelDateToJS(''), null);
  assert.strictEqual(excelDateToJS(null), null);
});

baslik('\nbelirleSube (Efes VKN özel mantığı)');
test('Efes VKN + ekstre yoksa kontrol grubuna düşer', ()=>{
  const r = belirleSube('3250032635', 'ES123', null, new Set(), new Set(), new Set());
  assert.strictEqual(r.grup, 'kontrol');
});
test('Keşan müşteri master seti içindeyse keşan grubuna düşer', ()=>{
  const kesanSeti = new Set([normVKN('1112223334')]);
  const r = belirleSube('1112223334', 'ES999', null, new Set(), kesanSeti, new Set());
  assert.strictEqual(r.grup, 'kesan');
});
test('hiçbir master ve Efes eşleşmesi yoksa kontrol grubuna düşer', ()=>{
  const r = belirleSube('9998887776', 'ES1', null, new Set(), new Set(), new Set());
  assert.strictEqual(r.grup, 'kontrol');
});

baslik('\nbelirleSube — manuel VKN şube ataması (kalıcı override)');
test('manuel atama varsa Efes/master mantığından ÖNCE uygulanır', ()=>{
  const manuelAtama = new Map([[normVKN('9998887776'), 'bayrampasa']]);
  const r = belirleSube('9998887776', 'ES1', null, new Set(), new Set(), new Set(), manuelAtama);
  assert.strictEqual(r.grup, 'bayrampasa');
});
test('manuel atama, VKN başka bir master sette olsa bile önceliklidir', ()=>{
  const kesanSeti = new Set([normVKN('1112223334')]); // bu VKN normalde Keşan'a düşerdi
  const manuelAtama = new Map([[normVKN('1112223334'), 'bayrampasa']]);
  const r = belirleSube('1112223334', 'ES999', null, new Set(), kesanSeti, new Set(), manuelAtama);
  assert.strictEqual(r.grup, 'bayrampasa');
});
test('manuel atama parametresi verilmezse (undefined) eski davranış korunur', ()=>{
  const r = belirleSube('9998887776', 'ES1', null, new Set(), new Set(), new Set());
  assert.strictEqual(r.grup, 'kontrol');
});

baslik('\nbelirleSube — zincir VKN istisnası (Migros senaryosu: VKN paylaşımlı marka)');
test('zincir VKN listesindeki bir VKN, Müşteri Master\'da olsa bile Kontrol\'e düşer', ()=>{
  const kesanSeti = new Set([normVKN('6220529513')]); // Migros VKN'si Master'da KAYITLI
  const zincirSeti = new Set([normVKN('6220529513')]); // ama zincir olarak işaretli
  const r = belirleSube('6220529513', 'M022026001306267', null, new Set(), kesanSeti, new Set(), new Map(), zincirSeti);
  assert.strictEqual(r.grup, 'kontrol');
});
test('zincir VKN istisnası, manuel VKN atamasından bile ÖNCELİKLİDİR', ()=>{
  const manuelAtama = new Map([[normVKN('6220529513'), 'kesan']]); // VKN bazlı manuel atama var
  const zincirSeti = new Set([normVKN('6220529513')]);
  const r = belirleSube('6220529513', 'M022026001306267', null, new Set(), new Set(), new Set(), manuelAtama, zincirSeti);
  assert.strictEqual(r.grup, 'kontrol'); // zincir listesi manuel atamayı bile ezer
});
test('zincir listesinde OLMAYAN bir VKN için normal mantık (Master/manuel atama) işler', ()=>{
  const kesanSeti = new Set([normVKN('1112223334')]);
  const zincirSeti = new Set([normVKN('6220529513')]); // farklı bir VKN zincirde
  const r = belirleSube('1112223334', 'ES1', null, new Set(), kesanSeti, new Set(), new Map(), zincirSeti);
  assert.strictEqual(r.grup, 'kesan'); // etkilenmedi, normal Master mantığı çalıştı
});
test('zincirVknSeti parametresi verilmezse (undefined) eski davranış korunur', ()=>{
  const kesanSeti = new Set([normVKN('6220529513')]);
  const r = belirleSube('6220529513', 'ES1', null, new Set(), kesanSeti, new Set());
  assert.strictEqual(r.grup, 'kesan'); // zincir kontrolü yoksa Master mantığı normal çalışır
});

baslik('\nvknZincirMi / zincir VKN listesi state okuma');
test('zincir listesine eklenen VKN doğru tespit edilir', ()=>{
  context.__test_zincir = new Set([normVKN('6220529513')]);
  vm.runInContext('state.zincirVknListesi = __test_zincir;', context);
  assert.strictEqual(context.vknZincirMi('6220529513'), true);
});
test('listede olmayan VKN için false döner', ()=>{
  assert.strictEqual(context.vknZincirMi('9998887776'), false);
});
test('VKN normalize edilerek (baştaki sıfırlar temizlenerek) aranır', ()=>{
  context.__test_zincir2 = new Set([normVKN('006220529513')]);
  vm.runInContext('state.zincirVknListesi = __test_zincir2;', context);
  assert.strictEqual(context.vknZincirMi('6220529513'), true);
});

baslik('\nfaturaSubesiAtanmisMi / fatura bazlı geçici atama state okuma');
test('atanmış faturaKey için doğru grup döner', ()=>{
  context.__test_fatura_sube = new Map([['vkn123::M|022026001306267', 'kesan']]);
  vm.runInContext('state.faturaSubeAtamalari = __test_fatura_sube;', context);
  assert.strictEqual(context.faturaSubesiAtanmisMi('vkn123::M|022026001306267'), 'kesan');
});
test('atanmamış faturaKey için null döner', ()=>{
  assert.strictEqual(context.faturaSubesiAtanmisMi('baska-fatura-key'), null);
});

baslik('\ncomputeRapor — zincir VKN + fatura bazlı atama entegrasyonu (Migros senaryosu)');
const migrosKaynaklari = {
  efaturaQnb: { rows: [
    {'GÖNDEREN VKN/TCKN':'6220529513','FATURA NO':'M022026001306267','FATURA TARİHİ':'03.06.2026','TUTAR':'516,97','GÖNDEREN UNVAN/AD SOYAD':'MİGROS TİCARET A.Ş. (Keşan Erikli)','DURUM':'Onaylandı'},
    {'GÖNDEREN VKN/TCKN':'6220529513','FATURA NO':'M022026001307973','FATURA TARİHİ':'04.06.2026','TUTAR':'646,45','GÖNDEREN UNVAN/AD SOYAD':'MİGROS TİCARET A.Ş. (Tekirdağ)','DURUM':'Onaylandı'},
  ]},
  musteriKesan: {rows: [{'Vergi No':'6220529513','TC Kimlik No':null}]}, // VKN Master'da KAYITLI
  musteriBayrampasa: {rows: []}, efesEkstre: null, netsis: null,
};
test('zincir VKN\'ye ait tüm faturalar Master\'da kayıtlı olsa bile önce Kontrol\'e düşer', ()=>{
  const zincirSeti = new Set([normVKN('6220529513')]);
  const rapor = computeRapor(migrosKaynaklari, {}, new Map(), zincirSeti, new Map());
  const f1 = rapor.faturalar.find(x=> x.faturaNo==='M022026001306267');
  const f2 = rapor.faturalar.find(x=> x.faturaNo==='M022026001307973');
  assert.strictEqual(f1.subeGrup, 'kontrol');
  assert.strictEqual(f2.subeGrup, 'kontrol');
});
test('fatura bazlı atama, SADECE atanan faturayı etkiler — aynı VKN\'nin diğer faturasını etkilemez', ()=>{
  const zincirSeti = new Set([normVKN('6220529513')]);
  const rapor1 = computeRapor(migrosKaynaklari, {}, new Map(), zincirSeti, new Map()); // önce anahtarları öğrenelim
  const f1anahtar = rapor1.faturalar.find(x=> x.faturaNo==='M022026001306267').faturaKey;

  const faturaSubeAtamalari = new Map([[f1anahtar, 'kesan']]); // sadece 1. fatura Keşan'a atandı
  const rapor2 = computeRapor(migrosKaynaklari, {}, new Map(), zincirSeti, faturaSubeAtamalari);
  const f1 = rapor2.faturalar.find(x=> x.faturaNo==='M022026001306267');
  const f2 = rapor2.faturalar.find(x=> x.faturaNo==='M022026001307973');
  assert.strictEqual(f1.subeGrup, 'kesan'); // atanan fatura Keşan'a düştü
  assert.strictEqual(f2.subeGrup, 'kontrol'); // atanmayan fatura hâlâ Kontrol'de kaldı
});
test('computeRapor üçüncü/dördüncü/beşinci parametreler verilmezse (undefined) hata vermez, eski davranış korunur', ()=>{
  const rapor = computeRapor(migrosKaynaklari, {});
  // zincir kontrolü yoksa Master'da kayıtlı VKN normal şekilde Keşan'a düşer
  const f1 = rapor.faturalar.find(x=> x.faturaNo==='M022026001306267');
  assert.strictEqual(f1.subeGrup, 'kesan');
});

baslik('\nvknSubesiAtanmisMi (state.subeAtamalari okuma)');
test('atanmış VKN için doğru grup döner', ()=>{
  stateSubeAtamalariniAyarla([[normVKN('9998887776'), 'bayrampasa']]);
  assert.strictEqual(vknSubesiAtanmisMi('9998887776'), 'bayrampasa');
});
test('atanmamış VKN için null döner', ()=>{
  stateSubeAtamalariniAyarla([[normVKN('9998887776'), 'bayrampasa']]);
  assert.strictEqual(vknSubesiAtanmisMi('1112223334'), null);
});
test('VKN normalize edilerek (baştaki sıfırlar temizlenerek) aranır', ()=>{
  stateSubeAtamalariniAyarla([[normVKN('0009998887776'), 'kesan']]);
  assert.strictEqual(vknSubesiAtanmisMi('9998887776'), 'kesan');
});

baslik('\ncomputeRapor — manuel şube ataması entegrasyonu');
const kontrolGrubuKaynaklari = {
  efaturaQnb: { rows: [
    {'GÖNDEREN VKN/TCKN':'9998887776','FATURA NO':'GKU2026000000530','FATURA TARİHİ':'30.06.2026','TUTAR':'4.065,25','GÖNDEREN UNVAN/AD SOYAD':'ALKAR DAĞITIM','DURUM':'Onaylandı'},
  ]},
  musteriKesan: {rows: []}, musteriBayrampasa: {rows: []}, efesEkstre: null, netsis: null,
};
test('VKN manuel Bayrampaşa\'ya atanınca fatura kontrol yerine Bayrampaşa grubuna düşer', ()=>{
  const subeAtamalari = new Map([[normVKN('9998887776'), 'bayrampasa']]);
  const rapor = computeRapor(kontrolGrubuKaynaklari, {}, subeAtamalari);
  const f = rapor.faturalar.find(x=> x.vkn==='9998887776');
  assert.strictEqual(f.subeGrup, 'bayrampasa');
  assert.strictEqual(rapor.gruplar.kontrol.length, 0);
  assert.strictEqual(rapor.gruplar.bayrampasa.length, 1);
});
test('şube ataması yokken aynı VKN kontrol grubunda kalır (regresyon)', ()=>{
  const rapor = computeRapor(kontrolGrubuKaynaklari, {}, new Map());
  const f = rapor.faturalar.find(x=> x.vkn==='9998887776');
  assert.strictEqual(f.subeGrup, 'kontrol');
});
test('computeRapor üçüncü parametre olarak plain object da kabul eder (IndexedDB\'den dönen hal)', ()=>{
  const subeAtamalariObje = { [normVKN('9998887776')]: 'kesan' };
  const rapor = computeRapor(kontrolGrubuKaynaklari, {}, subeAtamalariObje);
  const f = rapor.faturalar.find(x=> x.vkn==='9998887776');
  assert.strictEqual(f.subeGrup, 'kesan');
});

baslik('\ncomputeRapor + manuel durum işaretleme');
const ortakKaynaklar = {
  efaturaQnb: { rows: [
    {'GÖNDEREN VKN/TCKN':'3250032635','FATURA NO':'ES22026000020732','FATURA TARİHİ':'30.06.2026','TUTAR':'32.500,00','GÖNDEREN UNVAN/AD SOYAD':'EFES PAZARLAMA','DURUM':'Onaylandı'},
    {'GÖNDEREN VKN/TCKN':'3250032635','FATURA NO':'ES22026000021319','FATURA TARİHİ':'30.06.2026','TUTAR':'1.589,23','GÖNDEREN UNVAN/AD SOYAD':'EFES PAZARLAMA','DURUM':'Onaylandı'},
  ]},
  musteriKesan: {rows: []}, musteriBayrampasa: {rows: []}, efesEkstre: null, netsis: null,
};
const anahtar1 = matchKey('3250032635', 'ES22026000020732');
const anahtar2 = matchKey('3250032635', 'ES22026000021319');

test('manuel işaretleme yokken durum "islenmemis" kalır', ()=>{
  const rapor = computeRapor(ortakKaynaklar, {});
  assert.strictEqual(rapor.kpi.islenmemis, 2);
  assert.strictEqual(rapor.kpi.eslesti, 0);
});

test('"eslesti" manuel işaretlenince gerçek durum ve KPI güncellenir', ()=>{
  const manuel = {};
  manuel[anahtar1] = {durum:'eslesti', not:'', notGuncellemeZamani:null};
  const rapor = computeRapor(ortakKaynaklar, manuel);
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar1);
  assert.strictEqual(f.durum, 'eslesti');
  assert.strictEqual(f.orijinalDurum, 'islenmemis');
  assert.strictEqual(rapor.kpi.eslesti, 1);
  assert.strictEqual(rapor.kpi.islenmemis, 1);
});

test('"iade_kesilecek" manuel işaretlenince eşleşti sayılır, kpi.iadeKesilecek ve gruplar.notlu güncellenir', ()=>{
  const manuel = {};
  manuel[anahtar2] = {durum:'iade_kesilecek', not:'KEF2026 nolu fatura ile iade edildi', notGuncellemeZamani: new Date().toISOString()};
  const rapor = computeRapor(ortakKaynaklar, manuel);
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar2);
  assert.strictEqual(f.durum, 'eslesti');
  assert.strictEqual(f.manuelDurum, 'iade_kesilecek');
  assert.strictEqual(f.not, 'KEF2026 nolu fatura ile iade edildi');
  assert.strictEqual(rapor.kpi.eslesti, 1);
  assert.strictEqual(rapor.kpi.iadeKesilecek, 1); // istatistik alanı korunuyor
  assert.strictEqual(rapor.gruplar.notlu.length, 1); // artık ayrı "iade" grubu yok, genel "notlu" grubunda
  assert.strictEqual(rapor.gruplar.notlu[0].faturaKey, anahtar2);
});

test('sadece not eklenmiş (manuel durumu olmayan) fatura da gruplar.notlu\'ya düşer', ()=>{
  const manuel = {};
  manuel[anahtar1] = {durum:null, not:'Muhasebeciye sorulacak', notGuncellemeZamani: new Date().toISOString()};
  const rapor = computeRapor(ortakKaynaklar, manuel);
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar1);
  assert.strictEqual(f.manuelDurum, null); // manuel DURUM işareti yok, sadece not var
  assert.strictEqual(f.not, 'Muhasebeciye sorulacak');
  assert.strictEqual(rapor.gruplar.notlu.length, 1);
  assert.strictEqual(rapor.gruplar.notlu[0].faturaKey, anahtar1);
});

test('yetim manuel işaret: karşılığı olmayan key yetimManuel içinde raporlanır', ()=>{
  const manuel = {};
  manuel['olmayan::VKN|9999'] = {durum:'iade_kesilecek', not:'eski dosyadan kalma', notGuncellemeZamani:null};
  const rapor = computeRapor(ortakKaynaklar, manuel);
  assert.strictEqual(Array.isArray(rapor.yetimManuel), true);
  assert.strictEqual(rapor.yetimManuel.length, 1);
  assert.strictEqual(rapor.yetimManuel[0].not, 'eski dosyadan kalma');
});
test('geçerli manuel işaret yetim olarak raporlanmaz', ()=>{
  const manuel = {};
  manuel[anahtar1] = {durum:'eslesti', not:'', notGuncellemeZamani:null};
  const rapor = computeRapor(ortakKaynaklar, manuel);
  assert.strictEqual(rapor.yetimManuel.length, 0);
});

baslik('\nmanuel "eslesti" normalleşmesi (Netsis\'te sonradan bulunma)');
const netsisSonradanBulunanKaynaklar = {
  efaturaQnb: { rows: [
    {'GÖNDEREN VKN/TCKN':'3250032635','FATURA NO':'ES22026000020732','FATURA TARİHİ':'30.06.2026','TUTAR':'32.500,00','GÖNDEREN UNVAN/AD SOYAD':'EFES PAZARLAMA','DURUM':'Onaylandı'},
  ]},
  netsis: { rows: [
    {'VKN/TCKN':'3250032635','Belge No':'ES22026000020732','Tarih':'30.06.2026','Cari İsim':'EFES PAZARLAMA','KDV Toplamı':'0','Genel Toplam':'32.500,00'},
  ]},
  musteriKesan: {rows: []}, musteriBayrampasa: {rows: []}, efesEkstre: null,
};
test('fatura artık gerçekten Netsis\'te bulunuyorsa "eslesti" manuel işareti normalleşir (not korunur)', ()=>{
  const manuel = {};
  manuel[anahtar1] = {durum:'eslesti', not:'Muhasebeci onayladı', notGuncellemeZamani:'2026-06-01T00:00:00.000Z'};
  const rapor = computeRapor(netsisSonradanBulunanKaynaklar, manuel);
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar1);
  assert.strictEqual(f.durum, 'eslesti');
  assert.strictEqual(f.manuelDurum, null); // manuel etiket kalkmış olmalı
  assert.strictEqual(f.durumEtiket, 'Eşleşti'); // "(Manuel)" ibaresi olmadan normal etiket
  assert.strictEqual(f.not, 'Muhasebeci onayladı'); // not korunmuş olmalı
  assert.strictEqual(JSON.stringify(rapor.normallesenManuelIsaretler), JSON.stringify([anahtar1]));
});
test('fatura hâlâ Netsis\'te yoksa "eslesti" manuel işareti normalleşmez', ()=>{
  const manuel = {};
  manuel[anahtar1] = {durum:'eslesti', not:'', notGuncellemeZamani:null};
  const rapor = computeRapor(ortakKaynaklar, manuel); // ortakKaynaklar: netsis:null
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar1);
  assert.strictEqual(f.manuelDurum, 'eslesti'); // manuel etiket hâlâ duruyor
  assert.strictEqual(rapor.normallesenManuelIsaretler.length, 0);
});
test('"iade_kesilecek" manuel işareti, fatura Netsis\'te bulunsa bile normalleşmez', ()=>{
  const manuel = {};
  manuel[anahtar1] = {durum:'iade_kesilecek', not:'KEF ile iade edildi', notGuncellemeZamani:null};
  const rapor = computeRapor(netsisSonradanBulunanKaynaklar, manuel);
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar1);
  assert.strictEqual(f.manuelDurum, 'iade_kesilecek'); // kasıtlı işaret, otomatik kaldırılmaz
  assert.strictEqual(rapor.normallesenManuelIsaretler.length, 0);
});

baslik('\ntutar farkı (uyumsuzluk) tespiti');
const farkKaynaklari = {
  efaturaLogo: { rows: [
    {'Gönderici VKN':'1112223334','Fatura No':'FA2026000001','Fatura Tarihi':'30.06.2026','Toplam Tutar':'1.000,00','KDV Toplamı':'180,00','Gönderici Adı':'TEST A','Durum':'Onaylandı'},
  ]},
  netsis: { rows: [
    {'VKN/TCKN':'1112223334','Belge No':'FA2026000001','Tarih':'30.06.2026','Cari İsim':'TEST A','KDV Toplamı':'180,00','Genel Toplam':'950,00'},
  ]},
  musteriKesan:{rows:[]}, musteriBayrampasa:{rows:[]}, efesEkstre:null,
};
test('tutar tutmayan fatura "fark" durumuna düşer ve farkDetay taşır', ()=>{
  const rapor = computeRapor(farkKaynaklari, {});
  const f = rapor.faturalar.find(x=> x.durum==='fark');
  assert.ok(f, 'fark durumunda bir satır olmalı');
  assert.strictEqual(Math.abs(f.farkDetay.tutarFarkTutari), 50);
  assert.strictEqual(f.farkDetay.entegratorTutar, 1000);
  assert.strictEqual(f.farkDetay.netsisTutar, 950);
});

baslik('\ndonemIdUret / donemEtiketUret');
test('yıl-ay doğru formatta üretilir (0 tabanlı ay girdisi)', ()=>{
  assert.strictEqual(donemIdUret(2026, 5), '2026-06'); // Haziran = ay index 5
  assert.strictEqual(donemIdUret(2026, 0), '2026-01');
});
test('etiket Türkçe ay adıyla üretilir', ()=>{
  assert.strictEqual(donemEtiketUret('2026-06'), 'Haziran 2026');
  assert.strictEqual(donemEtiketUret(null), '—');
});

baslik('\nraporunAitOlduguDonem');
test('entegratör satırlarının çoğunluk ay-yılını bulur', ()=>{
  const rapor = computeRapor(ortakKaynaklar, {}); // iki satır da 30.06.2026
  assert.strictEqual(raporunAitOlduguDonem(rapor), '2026-06');
});
test('entegratör satırı yoksa null döner', ()=>{
  assert.strictEqual(raporunAitOlduguDonem({faturalar:[]}), null);
});

baslik('\nnetsisAnahtarKumesiCikar');
test('eşleşmiş ve sadece-netsis satırlarının anahtarları toplanır', ()=>{
  const rapor = computeRapor(farkKaynaklari, {}); // 1 eşleşen (fark durumunda ama netsisTutar dolu) satır
  const set = netsisAnahtarKumesiCikar(rapor);
  assert.strictEqual(set.size, 1);
  assert.ok(set.has(matchKey('1112223334','FA2026000001')));
});

baslik('\ndonemKarsilastirmaHesapla');
test('önceki dönem yoksa farklar null döner', ()=>{
  stateDonemleriniAyarla({ '2026-06': { donemId:'2026-06', ozet:{toplam:10,eslesti:8,islenmemis:1,entegratordeYok:0,fark:1,red:0,kontrol:0,toplamTutar:1000,toplamKdvEnt:180} } });
  const r = donemKarsilastirmaHesapla('2026-06');
  assert.strictEqual(r.farklar, null);
  assert.strictEqual(r.oncekiId, null);
});
test('iki dönem varsa fark ve eşleşme oranı hesaplanır', ()=>{
  stateDonemleriniAyarla({
    '2026-05': { donemId:'2026-05', ozet:{toplam:100,eslesti:80,islenmemis:15,entegratordeYok:2,fark:5,red:0,kontrol:3,toplamTutar:50000,toplamKdvEnt:9000} },
    '2026-06': { donemId:'2026-06', ozet:{toplam:120,eslesti:110,islenmemis:5,entegratordeYok:1,fark:4,red:0,kontrol:2,toplamTutar:60000,toplamKdvEnt:10800} },
  });
  const r = donemKarsilastirmaHesapla('2026-06');
  assert.strictEqual(r.oncekiId, '2026-05');
  assert.strictEqual(r.farklar.toplam.fark, 20);
  assert.strictEqual(r.farklar.islenmemis.fark, -10);
  assert.ok(Math.abs(r.eskiEslesmeOrani - 80) < 0.01);
  assert.ok(Math.abs(r.yeniEslesmeOrani - (110/120*100)) < 0.01);
  assert.ok(r.eslesmeOraniFarki > 0); // eşleşme oranı iyileşti
});

baslik('\ngunBazliBosluklariHesapla');
test('entegratörde olup Netsis\'te olmayan gün boşluk olarak raporlanır', ()=>{
  stateDonemleriniAyarla({
    '2026-06': {
      donemId:'2026-06',
      rapor: { faturalar: [
        { yon:'entegrator', faturaTarihi: new Date(2026,5,10).toISOString(), netsisTutar:null },
        { yon:'entegrator', faturaTarihi: new Date(2026,5,11).toISOString(), netsisTutar:500 },
        { yon:'netsis', faturaTarihi: new Date(2026,5,11).toISOString() },
      ]},
    },
  });
  const bosluklar = gunBazliBosluklariHesapla('2026-06');
  const gun10 = bosluklar.find(b=> b.gun===10);
  assert.ok(gun10, '10. gün boşluk olarak bulunmalı');
  assert.strictEqual(gun10.tur, 'netsis_eksik');
  assert.ok(!bosluklar.find(b=> b.gun===11), '11. gün her iki kaynakta da var, boşluk olmamalı');
});

baslik('\ndonemToplamOzetiHesapla');
test('tutar ve KDV farkı doğru hesaplanır', ()=>{
  stateDonemleriniAyarla({ '2026-06': { donemId:'2026-06', ozet:{toplamTutar:1000, toplamTutarNetsis:950, toplamKdvEnt:180, toplamKdvNetsis:171} } });
  const o = donemToplamOzetiHesapla('2026-06');
  assert.strictEqual(o.tutarFarki, 50);
  assert.ok(Math.abs(o.kdvFarki - 9) < 0.001);
});

baslik('\ndonemFarkiAySayisi');
test('aynı ay için 0 döner', ()=>{
  assert.strictEqual(donemFarkiAySayisi('2026-06','2026-06'), 0);
});
test('bir sonraki ay için 1 döner', ()=>{
  assert.strictEqual(donemFarkiAySayisi('2026-06','2026-07'), 1);
});
test('bir önceki ay için -1 döner', ()=>{
  assert.strictEqual(donemFarkiAySayisi('2026-06','2026-05'), -1);
});
test('yıl sınırını doğru geçer (Aralık -> Ocak)', ()=>{
  assert.strictEqual(donemFarkiAySayisi('2025-12','2026-01'), 1);
});
test('iki ay ileri için 2 döner', ()=>{
  assert.strictEqual(donemFarkiAySayisi('2026-06','2026-08'), 2);
});

baslik('\ndonemOtomatikYazilabilirMi (kullanıcı kuralı: aktif ay + 1 ay onaysız, gerisi onaylı)');
test('aktif dönemin kendisi otomatik yazılabilir', ()=>{
  assert.strictEqual(donemOtomatikYazilabilirMi('2026-06','2026-06'), true);
});
test('aktif dönemden bir sonraki ay otomatik yazılabilir', ()=>{
  assert.strictEqual(donemOtomatikYazilabilirMi('2026-06','2026-07'), true);
});
test('aktif dönemden bir önceki ay OTOMATİK YAZILAMAZ (onay gerekir)', ()=>{
  assert.strictEqual(donemOtomatikYazilabilirMi('2026-06','2026-05'), false);
});
test('aktif dönemden iki ay sonrası OTOMATİK YAZILAMAZ (onay gerekir)', ()=>{
  assert.strictEqual(donemOtomatikYazilabilirMi('2026-06','2026-08'), false);
});
test('aktif dönem belirlenemiyorsa (null) engelleme yapılmaz', ()=>{
  assert.strictEqual(donemOtomatikYazilabilirMi(null,'2026-05'), true);
});

baslik('\ndonemeAitSatirlariFiltrele');
test('sadece verilen aya ait faturaTarihi olan satırlar döner', ()=>{
  const rapor = {faturalar:[
    {faturaKey:'a', faturaTarihi:new Date(2026,5,10).toISOString()},
    {faturaKey:'b', faturaTarihi:new Date(2026,6,1).toISOString()},
    {faturaKey:'c', faturaTarihi:null},
  ]};
  const sonuc = donemeAitSatirlariFiltrele(rapor, '2026-06');
  assert.strictEqual(sonuc.length, 1);
  assert.strictEqual(sonuc[0].faturaKey, 'a');
});

baslik('\ndonemGuncellemeAnaliziniYap — çok-dönemli Netsis analizi');
test('aktif dönem (Haziran) ve bir sonraki ay (Temmuz) otomatik listede, onay istenmez', ()=>{
  stateDonemleriniAyarla({}); // hiçbir dönem arşivlenmemiş henüz
  const rapor = {faturalar:[
    // Aktif dönemi Haziran yapmak için çoğunluk entegratör satırı Haziran'da olmalı
    {yon:'entegrator', faturaKey:'e1', faturaTarihi:new Date(2026,5,10).toISOString(), netsisTutar:100},
    {yon:'entegrator', faturaKey:'e2', faturaTarihi:new Date(2026,5,12).toISOString(), netsisTutar:null},
    {yon:'netsis', faturaKey:'n1', faturaTarihi:new Date(2026,6,5).toISOString()}, // Temmuz - sadece netsis'te
  ]};
  const analiz = donemGuncellemeAnaliziniYap(rapor);
  assert.strictEqual(analiz.aktifDonemId, '2026-06');
  assert.ok(analiz.otomatikYazilacakDonemler.includes('2026-06'));
  assert.ok(analiz.otomatikYazilacakDonemler.includes('2026-07'));
  assert.strictEqual(analiz.onayBekleyenDonemler.length, 0);
});

test('aktif dönemden önceki bir ay (Mayıs), zaten arşivlenmiş ve fark varsa onay bekler', ()=>{
  const eskiAnahtar = matchKey('1112223334','ESKI001');
  stateDonemleriniAyarla({
    '2026-05': {
      donemId:'2026-05',
      netsisAnahtarlari: [eskiAnahtar],
      rapor: {faturalar:[
        {faturaKey:eskiAnahtar, faturaNo:'ESKI001', vkn:'1112223334', gonderenUnvan:'ESKİ FİRMA', tutar:750, netsisTutar:750, faturaTarihi:new Date(2026,4,20).toISOString(), yon:'entegrator'},
      ]},
    },
  });
  const yeniAnahtar = matchKey('1112223334','YENI002');
  const rapor = {faturalar:[
    {yon:'entegrator', faturaKey:'e1', faturaTarihi:new Date(2026,5,10).toISOString(), netsisTutar:100}, // aktif dönem Haziran
    // Mayıs'a ait YENİ bir Netsis kaydı — eski arşivde YOKTU
    {yon:'netsis', faturaKey:yeniAnahtar, faturaNo:'YENI002', vkn:'1112223334', gonderenUnvan:'YENİ FİRMA', tutar:300, netsisTutar:300, faturaTarihi:new Date(2026,4,5).toISOString()},
    // Mayıs'ın eski kaydı bu yeni dosyada YOK (eksik)
  ]};
  const analiz = donemGuncellemeAnaliziniYap(rapor);
  assert.strictEqual(analiz.onayBekleyenDonemler.length, 1);
  const mayisAnaliz = analiz.onayBekleyenDonemler[0];
  assert.strictEqual(mayisAnaliz.donemId, '2026-05');
  assert.strictEqual(mayisAnaliz.yeniVeyaDegisenSatirlar.length, 1);
  assert.strictEqual(mayisAnaliz.yeniVeyaDegisenSatirlar[0].faturaKey, yeniAnahtar);
  assert.strictEqual(mayisAnaliz.eksikSatirlar.length, 1);
  assert.strictEqual(mayisAnaliz.eksikSatirlar[0].faturaKey, eskiAnahtar);
});

test('aktif dönemden 2+ ay sonrası (Ağustos) da onay bekler', ()=>{
  stateDonemleriniAyarla({
    '2026-08': { donemId:'2026-08', netsisAnahtarlari: [] },
  });
  const rapor = {faturalar:[
    {yon:'entegrator', faturaKey:'e1', faturaTarihi:new Date(2026,5,10).toISOString(), netsisTutar:100}, // aktif Haziran
    {yon:'netsis', faturaKey:'n-agustos', faturaTarihi:new Date(2026,7,1).toISOString()}, // Ağustos
  ]};
  const analiz = donemGuncellemeAnaliziniYap(rapor);
  assert.ok(!analiz.otomatikYazilacakDonemler.includes('2026-08'));
  const agustosAnaliz = analiz.onayBekleyenDonemler.find(d=> d.donemId==='2026-08');
  assert.ok(agustosAnaliz, 'Ağustos onay bekleyenler arasında olmalı');
});

test('geçmiş ay hiç arşivlenmemişse (ilk kez) otomatik yazılır, onay istenmez', ()=>{
  stateDonemleriniAyarla({}); // Mart hiç arşivlenmemiş
  const rapor = {faturalar:[
    {yon:'entegrator', faturaKey:'e1', faturaTarihi:new Date(2026,5,10).toISOString(), netsisTutar:100}, // aktif Haziran
    {yon:'netsis', faturaKey:'n-mart', faturaTarihi:new Date(2026,2,1).toISOString()}, // Mart - hiç arşiv yok
  ]};
  const analiz = donemGuncellemeAnaliziniYap(rapor);
  assert.ok(analiz.otomatikYazilacakDonemler.includes('2026-03'));
  assert.ok(!analiz.onayBekleyenDonemler.find(d=> d.donemId==='2026-03'));
});

test('farksız geçmiş dönem (arşivle birebir aynı) onay listesine hiç girmez', ()=>{
  const anahtar = matchKey('1112223334','AYNI001');
  stateDonemleriniAyarla({
    '2026-05': {
      donemId:'2026-05', netsisAnahtarlari: [anahtar],
      rapor: {faturalar:[{faturaKey:anahtar, faturaTarihi:new Date(2026,4,10).toISOString()}]},
    },
  });
  const rapor = {faturalar:[
    {yon:'entegrator', faturaKey:'e1', faturaTarihi:new Date(2026,5,10).toISOString(), netsisTutar:100}, // aktif Haziran
    {yon:'netsis', faturaKey:anahtar, faturaTarihi:new Date(2026,4,10).toISOString()}, // Mayıs, arşivle birebir aynı
  ]};
  const analiz = donemGuncellemeAnaliziniYap(rapor);
  assert.strictEqual(analiz.onayBekleyenDonemler.length, 0);
});

baslik('\ndonemOnayiUygula');
test('işaretlenen (çıkarılacak) eksik satır arşivden silinir, işaretlenmeyen kalır', async ()=>{
  const eskiAnahtar1 = matchKey('1112223334','ESKI001');
  const eskiAnahtar2 = matchKey('1112223334','ESKI002');
  stateDonemleriniAyarla({
    '2026-05': {
      donemId:'2026-05',
      netsisAnahtarlari: [eskiAnahtar1, eskiAnahtar2],
      rapor: {faturalar:[
        {faturaKey:eskiAnahtar1, faturaNo:'ESKI001', faturaTarihi:new Date(2026,4,10).toISOString(), yon:'entegrator', tutar:100, netsisTutar:100},
        {faturaKey:eskiAnahtar2, faturaNo:'ESKI002', faturaTarihi:new Date(2026,4,11).toISOString(), yon:'entegrator', tutar:200, netsisTutar:200},
      ], kpi:{}, gruplar:{}},
    },
  });
  const onayBekleyenDonem = {
    donemId: '2026-05',
    yeniVeyaDegisenSatirlar: [],
    eksikSatirlar: [
      {faturaKey:eskiAnahtar1, faturaNo:'ESKI001'},
      {faturaKey:eskiAnahtar2, faturaNo:'ESKI002'},
    ],
  };
  // Kullanıcı sadece eskiAnahtar1'i "elle çıkar" olarak işaretledi; eskiAnahtar2 işaretlenmedi (kalsın).
  await donemOnayiUygula(onayBekleyenDonem, new Set([eskiAnahtar1]));

  const guncelArsivJson = await vm.runInContext('JSON.stringify(state.donemler["2026-05"].rapor.faturalar)', context);
  const guncelSatirlar = JSON.parse(guncelArsivJson);
  const kalanAnahtarlar = guncelSatirlar.map(f=> f.faturaKey);
  assert.ok(!kalanAnahtarlar.includes(eskiAnahtar1), 'işaretlenen (çıkarılacak) satır arşivde OLMAMALI');
  assert.ok(kalanAnahtarlar.includes(eskiAnahtar2), 'işaretlenmeyen satır arşivde KALMALI');
});

test('yeni/değişen satırlar onaya bakılmaksızın her zaman eklenir', async ()=>{
  stateDonemleriniAyarla({
    '2026-05': {
      donemId:'2026-05',
      netsisAnahtarlari: [],
      rapor: {faturalar:[], kpi:{}, gruplar:{}},
    },
  });
  const yeniAnahtar = matchKey('1112223334','YENI099');
  const onayBekleyenDonem = {
    donemId: '2026-05',
    yeniVeyaDegisenSatirlar: [
      {faturaKey:yeniAnahtar, faturaNo:'YENI099', faturaTarihi:new Date(2026,4,20).toISOString(), yon:'entegrator', tutar:400, netsisTutar:400},
    ],
    eksikSatirlar: [],
  };
  await donemOnayiUygula(onayBekleyenDonem, new Set());
  const guncelArsivJson = await vm.runInContext('JSON.stringify(state.donemler["2026-05"].rapor.faturalar)', context);
  const guncelSatirlar = JSON.parse(guncelArsivJson);
  assert.ok(guncelSatirlar.map(f=> f.faturaKey).includes(yeniAnahtar));
});

baslik('\nderinDateTemizle (RTDB Date nesnesi uyumsuzluğu regresyon testi)');
test('gerçek Date nesnesi içeren obje ISO string\'e çevrilir (RTDB Date kabul etmez)', ()=>{
  const girdi = {faturaTarihi: new Date(2026,5,15), tutar: 100};
  const cikti = derinDateTemizle(girdi);
  assert.strictEqual(typeof cikti.faturaTarihi, 'string');
  assert.strictEqual(cikti.faturaTarihi, new Date(2026,5,15).toISOString());
});
test('derin iç içe (nested) Date nesneleri de temizlenir (rapor.faturalar[].faturaTarihi senaryosu)', ()=>{
  const girdi = {
    rapor: {
      faturalar: [
        {faturaKey:'a', faturaTarihi: new Date(2026,5,10)},
        {faturaKey:'b', faturaTarihi: new Date(2026,5,11)},
      ],
    },
  };
  const cikti = derinDateTemizle(girdi);
  assert.strictEqual(typeof cikti.rapor.faturalar[0].faturaTarihi, 'string');
  assert.strictEqual(typeof cikti.rapor.faturalar[1].faturaTarihi, 'string');
});
test('undefined girdi için null döner (RTDB undefined kabul etmez)', ()=>{
  assert.strictEqual(derinDateTemizle(undefined), null);
});
test('zaten string olan tarihlere dokunmaz', ()=>{
  const girdi = {faturaTarihi: '2026-06-15T00:00:00.000Z'};
  const cikti = derinDateTemizle(girdi);
  assert.strictEqual(cikti.faturaTarihi, '2026-06-15T00:00:00.000Z');
});

baslik('\nderinAnahtarKodla / derinAnahtarKodCoz (RTDB yasaklı anahtar karakteri regresyon testi)');
test('"/" içeren anahtar (örn. Excel sütun adı "İptal / İtiraz Durumu") kodlanır', ()=>{
  const girdi = {'İptal / İtiraz Durumu': 'Var'};
  const kodlanmis = derinAnahtarKodla(girdi);
  assert.ok(!Object.keys(kodlanmis)[0].includes('/'), 'kodlanmış anahtar "/" içermemeli');
});
test('kodlanmış anahtar, derinAnahtarKodCoz ile TAM olarak orijinaline geri döner', ()=>{
  const girdi = {'İptal / İtiraz Durumu': 'Var', normal: 'değer'};
  const kodlanmis = derinAnahtarKodla(girdi);
  const cozulmus = derinAnahtarKodCoz(kodlanmis);
  assert.strictEqual(JSON.stringify(cozulmus), JSON.stringify(girdi));
});
test('RTDB\'nin yasakladığı 6 karakterin (. # $ / [ ]) hepsi için round-trip doğru çalışır', ()=>{
  const girdi = {'a.b#c$d/e[f]g': 1};
  const kodlanmis = derinAnahtarKodla(girdi);
  const kodlanmisAnahtar = Object.keys(kodlanmis)[0];
  assert.ok(!/[.#$\/\[\]]/.test(kodlanmisAnahtar), 'kodlanmış anahtarda yasaklı karakter kalmamalı: ' + kodlanmisAnahtar);
  const cozulmus = derinAnahtarKodCoz(kodlanmis);
  assert.strictEqual(Object.keys(cozulmus)[0], 'a.b#c$d/e[f]g');
});
test('derin iç içe (nested) obje ve dizi içindeki anahtarlar da kodlanıp çözülür (rows[].sütun adı senaryosu)', ()=>{
  const girdi = {
    earsiv: { rows: [
      {'İptal / İtiraz Durumu': 'Var', 'Fatura No': 'ES123'},
      {'İptal / İtiraz Durumu': '', 'Fatura No': 'ES124'},
    ]},
  };
  const kodlanmis = derinAnahtarKodla(girdi);
  const anahtarlarTemizMi = Object.keys(kodlanmis.earsiv.rows[0]).every(k=> !k.includes('/'));
  assert.ok(anahtarlarTemizMi, 'iç içe dizideki satırların anahtarları da kodlanmalı');
  const cozulmus = derinAnahtarKodCoz(kodlanmis);
  assert.strictEqual(JSON.stringify(cozulmus), JSON.stringify(girdi));
});
test('kodlama sadece ANAHTARLARI değiştirir, değerlere (string içeriğine) dokunmaz', ()=>{
  const girdi = {normalAnahtar: 'Bu değer İptal / İtiraz Durumu gibi karakterler içerebilir'};
  const kodlanmis = derinAnahtarKodla(girdi);
  assert.strictEqual(kodlanmis.normalAnahtar, girdi.normalAnahtar); // değer aynı kalmalı
});

baslik('\nraporEksikAlanlariTamamla (string tarihi tekrar Date\'e çevirme regresyon testi)');
test('string faturaTarihi, gerçek Date nesnesine geri çevrilir', ()=>{
  const vm2 = require('vm');
  const ctx2 = { document: {...sahteDocument, addEventListener(){}}, window: sahteWindow, console };
  vm2.createContext(ctx2);
  vm2.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', '05-uygulama.js'), 'utf8'), ctx2);
  const rapor = {faturalar:[{faturaKey:'x', faturaTarihi:'2026-06-15T00:00:00.000Z'}]};
  const sonuc = ctx2.raporEksikAlanlariTamamla(rapor);
  const faturaTarihi = sonuc.faturalar[0].faturaTarihi;
  // NOT: instanceof Date, farklı VM context'lerinden (realm) gelen Date nesneleri için
  // false dönebilir (her realm kendi Date sınıfına sahiptir) — bu yüzden cross-realm
  // güvenli olan Object.prototype.toString.call() ile kontrol ediyoruz.
  assert.strictEqual(Object.prototype.toString.call(faturaTarihi), '[object Date]', 'faturaTarihi gerçek Date nesnesi olmalı');
  assert.strictEqual(faturaTarihi.getFullYear(), 2026);
  assert.strictEqual(faturaTarihi.getMonth(), 5); // Haziran
});

asyncTestZinciri.then(()=>{
  console.log(`\n${gecen}/${toplam} test geçti.`);
  process.exit(gecen === toplam ? 0 : 1);
});
