'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const kod01 = fs.readFileSync(path.join(__dirname, '..', 'js', '01-cekirdek.js'), 'utf8');
const kod02 = fs.readFileSync(path.join(__dirname, '..', 'js', '02-veri-yukleme.js'), 'utf8');
const kod03 = fs.readFileSync(path.join(__dirname, '..', 'js', '03-eslestirme.js'), 'utf8');
const kod07 = fs.readFileSync(path.join(__dirname, '..', 'js', '07-donem-arsivi.js'), 'utf8');
const kod08 = fs.readFileSync(path.join(__dirname, '..', 'js', '08-senkron-katmani.js'), 'utf8');

const sahteDocument = {
  getElementById: ()=> null,
  createElement: ()=> ({ classList:{add(){}}, style:{}, appendChild(){}, addEventListener(){}, querySelector(){ return null; } }),
  body: { prepend(){} },
};
const sahteWindow = { indexedDB: {} };

const context = { document: sahteDocument, window: sahteWindow, indexedDB: {} };
const vm = require('vm');
vm.createContext(context);
vm.runInContext(kod01, context);
vm.runInContext(kod02, context);
vm.runInContext(kod03, context);
vm.runInContext(kod07, context);
vm.runInContext(kod08, context);

const {
  normVKN, parseFaturaNo, digitsYakinMi, faturaNoYakinMi, matchKey, toNumber,
  belirleSube, computeRapor, excelDateToJS,
  donemIdUret, donemEtiketUret, raporunAitOlduguDonem, netsisAnahtarKumesiCikar,
  donemKarsilastirmaHesapla, gunBazliBosluklariHesapla, donemToplamOzetiHesapla,
  gecmiseEklenenNetsisKayitlariBul, vknSubesiAtanmisMi,
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
function test(ad, fn){
  toplam++;
  try{
    fn();
    gecen++;
    console.log(`  OK  ${ad}`);
  }catch(err){
    console.log(`FAIL  ${ad}`);
    console.log(`      ${err.message}`);
  }
}

console.log('normVKN');
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

console.log('\nparseFaturaNo');
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

console.log('\ndigitsYakinMi (tek haneli sıfır kayması toleransı)');
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

console.log('\nfaturaNoYakinMi');
test('prefix farklıysa false döner', ()=>{
  assert.strictEqual(faturaNoYakinMi('ES2026123', 'FA2026123'), false);
});
test('prefix aynı, rakamlar sıfır kaymasıyla yakınsa true döner', ()=>{
  assert.strictEqual(faturaNoYakinMi('ES2026000020732', 'ES202600020732'), true);
});

console.log('\nmatchKey');
test('vkn ve fatura no birlikte anahtar üretir', ()=>{
  const k1 = matchKey('3250032635', 'ES22026000020732');
  const k2 = matchKey('03250032635', 'es22026000020732');
  assert.strictEqual(k1, k2);
});

console.log('\ntoNumber');
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

console.log('\nexcelDateToJS (tarih güvenilirliği)');
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

console.log('\nbelirleSube (Efes VKN özel mantığı)');
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

console.log('\nbelirleSube — manuel VKN şube ataması (kalıcı override)');
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

console.log('\nvknSubesiAtanmisMi (state.subeAtamalari okuma)');
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

console.log('\ncomputeRapor — manuel şube ataması entegrasyonu');
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

console.log('\ncomputeRapor + manuel durum işaretleme');
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

test('"iade_kesilecek" manuel işaretlenince eşleşti sayılır ve iadeKesilecek grubuna düşer', ()=>{
  const manuel = {};
  manuel[anahtar2] = {durum:'iade_kesilecek', not:'KEF2026 nolu fatura ile iade edildi', notGuncellemeZamani: new Date().toISOString()};
  const rapor = computeRapor(ortakKaynaklar, manuel);
  const f = rapor.faturalar.find(x=> x.faturaKey===anahtar2);
  assert.strictEqual(f.durum, 'eslesti');
  assert.strictEqual(f.manuelDurum, 'iade_kesilecek');
  assert.strictEqual(f.not, 'KEF2026 nolu fatura ile iade edildi');
  assert.strictEqual(rapor.kpi.eslesti, 1);
  assert.strictEqual(rapor.gruplar.iadeKesilecek.length, 1);
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

console.log('\nmanuel "eslesti" normalleşmesi (Netsis\'te sonradan bulunma)');
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

console.log('\ntutar farkı (uyumsuzluk) tespiti');
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

console.log('\ndonemIdUret / donemEtiketUret');
test('yıl-ay doğru formatta üretilir (0 tabanlı ay girdisi)', ()=>{
  assert.strictEqual(donemIdUret(2026, 5), '2026-06'); // Haziran = ay index 5
  assert.strictEqual(donemIdUret(2026, 0), '2026-01');
});
test('etiket Türkçe ay adıyla üretilir', ()=>{
  assert.strictEqual(donemEtiketUret('2026-06'), 'Haziran 2026');
  assert.strictEqual(donemEtiketUret(null), '—');
});

console.log('\nraporunAitOlduguDonem');
test('entegratör satırlarının çoğunluk ay-yılını bulur', ()=>{
  const rapor = computeRapor(ortakKaynaklar, {}); // iki satır da 30.06.2026
  assert.strictEqual(raporunAitOlduguDonem(rapor), '2026-06');
});
test('entegratör satırı yoksa null döner', ()=>{
  assert.strictEqual(raporunAitOlduguDonem({faturalar:[]}), null);
});

console.log('\nnetsisAnahtarKumesiCikar');
test('eşleşmiş ve sadece-netsis satırlarının anahtarları toplanır', ()=>{
  const rapor = computeRapor(farkKaynaklari, {}); // 1 eşleşen (fark durumunda ama netsisTutar dolu) satır
  const set = netsisAnahtarKumesiCikar(rapor);
  assert.strictEqual(set.size, 1);
  assert.ok(set.has(matchKey('1112223334','FA2026000001')));
});

console.log('\ndonemKarsilastirmaHesapla');
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

console.log('\ngunBazliBosluklariHesapla');
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

console.log('\ndonemToplamOzetiHesapla');
test('tutar ve KDV farkı doğru hesaplanır', ()=>{
  stateDonemleriniAyarla({ '2026-06': { donemId:'2026-06', ozet:{toplamTutar:1000, toplamTutarNetsis:950, toplamKdvEnt:180, toplamKdvNetsis:171} } });
  const o = donemToplamOzetiHesapla('2026-06');
  assert.strictEqual(o.tutarFarki, 50);
  assert.ok(Math.abs(o.kdvFarki - 9) < 0.001);
});

console.log('\ngecmiseEklenenNetsisKayitlariBul');
test('arşivlenmiş geçmiş bir aya ait olup o dönem arşivinde olmayan Netsis kaydı tespit edilir', ()=>{
  // Mayıs ayı arşivlenmiş ama bu Netsis kaydının anahtarı o arşivde YOK — yani sonradan eklenmiş.
  stateDonemleriniAyarla({
    '2026-05': { donemId:'2026-05', netsisAnahtarlari: [] },
  });
  const rapor = {
    faturalar: [
      { yon:'netsis', faturaKey: matchKey('1112223334','FA2026000099'), faturaNo:'FA2026000099', vkn:'1112223334',
        gonderenUnvan:'TEST A', tutar:500, netsisTutar:500, faturaTarihi: new Date(2026,4,15).toISOString() },
      { yon:'entegrator', faturaKey: matchKey('1112223334','FA2026000001'), faturaNo:'FA2026000001', vkn:'1112223334',
        gonderenUnvan:'TEST A', tutar:1000, faturaTarihi: new Date(2026,5,10).toISOString() }, // bu ayın kendi kaydı, atlanır
    ],
  };
  const sonuc = gecmiseEklenenNetsisKayitlariBul(rapor);
  assert.strictEqual(sonuc.length, 1);
  assert.strictEqual(sonuc[0].aitOlduguDonemId, '2026-05');
  assert.strictEqual(sonuc[0].faturaNo, 'FA2026000099');
});
test('arşivde zaten var olan kayıt için uyarı üretilmez', ()=>{
  const anahtar = matchKey('1112223334','FA2026000099');
  stateDonemleriniAyarla({
    '2026-05': { donemId:'2026-05', netsisAnahtarlari: [anahtar] },
  });
  const rapor = {
    faturalar: [
      { yon:'netsis', faturaKey: anahtar, faturaNo:'FA2026000099', vkn:'1112223334',
        gonderenUnvan:'TEST A', tutar:500, netsisTutar:500, faturaTarihi: new Date(2026,4,15).toISOString() },
    ],
  };
  const sonuc = gecmiseEklenenNetsisKayitlariBul(rapor);
  assert.strictEqual(sonuc.length, 0);
});
test('hiç arşivlenmemiş geçmiş bir ay için kıyaslama yapılmaz (sessizce atlanır)', ()=>{
  stateDonemleriniAyarla({}); // hiçbir dönem arşivlenmemiş
  const rapor = {
    faturalar: [
      { yon:'netsis', faturaKey: matchKey('1112223334','FA2026000099'), faturaNo:'FA2026000099', vkn:'1112223334',
        gonderenUnvan:'TEST A', tutar:500, netsisTutar:500, faturaTarihi: new Date(2026,4,15).toISOString() },
    ],
  };
  const sonuc = gecmiseEklenenNetsisKayitlariBul(rapor);
  assert.strictEqual(sonuc.length, 0);
});

console.log(`\n${gecen}/${toplam} test geçti.`);
process.exit(gecen === toplam ? 0 : 1);
