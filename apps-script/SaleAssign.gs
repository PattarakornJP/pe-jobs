/**
 * แท็บ sale_assign — จำว่าลูกค้าคนไหนย้ายไปเซลล์คนใหม่
 * ไม่แตะแท็บ jobs, service, plan, nonstock และไม่เขียนทับงาน
 *
 * ใส่บน Apps Script เดิมของชีต PE Jobs เท่านั้น อย่าสร้างเว็บแอปใหม่
 * อย่าแทนที่ไฟล์ Code.gs ทั้งไฟล์ เพราะรหัสผู้ดูแลที่พิมพ์ไว้จะหาย
 *
 * 1) เปิดชีต PE Jobs > ส่วนขยาย > Apps Script
 * 2) กด + > Script ตั้งชื่อ SaleAssign แล้ววางไฟล์นี้ทั้งก้อน
 * 3) ใน Code.gs ที่ function doGet อยู่แล้ว ให้ใส่บรรทัด saleAssign
 *    ต่อจากบรรทัดที่ตรวจ action ของ resolveMap (หรือเป็นบรรทัดแรกในฟังก์ชัน ถ้ายังไม่มี action)
 *      if (action === 'saleAssign' && typeof doGetSaleAssign_ === 'function') return doGetSaleAssign_(e);
 *    ถ้ายังไม่มีตัวแปร action ให้ใส่สองบรรทัดนี้ไว้บนสุดของ doGet หลัง e = e || {};
 *      var action = String((e.parameter && e.parameter.action) || '').trim();
 *      if (action === 'saleAssign' && typeof doGetSaleAssign_ === 'function') return doGetSaleAssign_(e);
 * 4) ใน function doPost หลังตรวจว่า body เป็น object แล้ว ใส่ก่อนบรรทัดที่แยก service/plan
 *      if (String(body.action || '') === 'saleAssign' || requestedTable_(body) === 'sale_assign') {
 *        if (typeof postSaleAssign_ === 'function') return postSaleAssign_(body);
 *        return json_({ ok: false, action: 'saleAssign', error: 'ยังไม่พร้อม' });
 *      }
 * 5) ใน function requestedTable_ ก่อนบรรทัด return 'jobs' ใส่
 *      if (t === 'sale_assign' || t === 'saleassign') return 'sale_assign';
 * 6) อย่าแก้บรรทัด ADMIN_KEY
 * 7) Deploy > Manage deployments > รูปดินสอที่ deployment เดิม
 *    Version = New version > Deploy
 *    ไม่ต้องเปลี่ยน URL ในเว็บ
 *
 * ถ้ายังไม่ทำขั้นนี้ เว็บยังเปลี่ยนเซลล์ได้บนเบราว์เซอร์นั้น และจะไม่ส่งอะไรไปทับชีตงาน
 */

var SALE_ASSIGN_SHEET = 'sale_assign';
var SALE_ASSIGN_HEADERS = ['company', 'hotel', 'baseSale', 'sale', 'nick', 'updatedAt'];

function doGetSaleAssign_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return emit_(e, { ok: false, action: 'saleAssign', error: 'ระบบไม่ว่าง รอสักครู่แล้วกด โหลดใหม่' });
  }
  try {
    var rows = readSaleAssignRows_();
    return emit_(e, { ok: true, action: 'saleAssign', count: rows.length, rows: rows });
  } catch (err) {
    return emit_(e, { ok: false, action: 'saleAssign', error: 'อ่านรายการเซลล์ไม่สำเร็จ' });
  } finally {
    lock.releaseLock();
  }
}

function postSaleAssign_(body) {
  var denied = saleAssignAuth_(body);
  if (denied) return denied;
  var company = normSale_(body.company);
  var hotel = normSale_(body.hotel);
  var baseSale = normSale_(body.baseSale);
  var sale = normSale_(body.sale);
  var nick = normSale_(body.nick);
  if (!company && !hotel && !baseSale) {
    return json_({ ok: false, action: 'saleAssign', error: 'ไม่มีรายการให้บันทึก' });
  }
  var clear = !sale || !nick || sale === baseSale;
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, action: 'saleAssign', error: 'ระบบไม่ว่าง รอสักครู่แล้วกด บันทึก อีกครั้ง' });
  }
  try {
    var sh = saleAssignSheet_();
    var values = sh.getDataRange().getValues();
    var kept = [];
    var i;
    for (i = 1; i < values.length; i++) {
      var same = normSale_(values[i][0]) === company &&
        normSale_(values[i][1]) === hotel &&
        normSale_(values[i][2]) === baseSale;
      if (same) continue;
      if (!normSale_(values[i][0]) && !normSale_(values[i][1]) && !normSale_(values[i][2])) continue;
      kept.push([
        normSale_(values[i][0]),
        normSale_(values[i][1]),
        normSale_(values[i][2]),
        normSale_(values[i][3]),
        normSale_(values[i][4]),
        String(values[i][5] || '')
      ]);
    }
    if (!clear) kept.push([company, hotel, baseSale, sale, nick, new Date().toISOString()]);
    if (kept.length > 5000) {
      return json_({ ok: false, action: 'saleAssign', error: 'จำนวนรายการมากเกินไป จึงยังไม่บันทึก' });
    }
    var last = Math.max(sh.getLastRow(), 1);
    if (last > 1) sh.getRange(2, 1, last - 1, SALE_ASSIGN_HEADERS.length).clearContent();
    if (kept.length) sh.getRange(2, 1, kept.length, SALE_ASSIGN_HEADERS.length).setValues(kept);
    return json_({ ok: true, action: 'saleAssign', saved: true, count: kept.length });
  } catch (err) {
    return json_({ ok: false, action: 'saleAssign', error: 'บันทึกไม่สำเร็จ ลองอีกครั้ง' });
  } finally {
    lock.releaseLock();
  }
}

function saleAssignAuth_(body) {
  var adminKey = String(ADMIN_KEY || '').trim();
  if (!adminKey) {
    return json_({
      ok: false,
      action: 'saleAssign',
      auth: false,
      error: 'ยังไม่ได้ตั้งรหัส เปิด Apps Script แล้วใส่รหัสที่บรรทัด ADMIN_KEY'
    });
  }
  var given = String((body && body.key) || '').trim();
  if (!given || given !== adminKey) {
    return json_({ ok: false, action: 'saleAssign', auth: false, error: 'รหัสไม่ถูกต้อง ใส่รหัสใหม่อีกครั้ง' });
  }
  return null;
}

function saleAssignSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SALE_ASSIGN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(SALE_ASSIGN_SHEET);
    sh.getRange(1, 1, 1, SALE_ASSIGN_HEADERS.length).setValues([SALE_ASSIGN_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readSaleAssignRows_() {
  var sh = saleAssignSheet_();
  var values = sh.getDataRange().getValues();
  var out = [];
  var i;
  for (i = 1; i < values.length; i++) {
    var company = normSale_(values[i][0]);
    var hotel = normSale_(values[i][1]);
    var baseSale = normSale_(values[i][2]);
    var sale = normSale_(values[i][3]);
    var nick = normSale_(values[i][4]);
    if (!company && !hotel && !baseSale) continue;
    if (!sale || !nick || sale === baseSale) continue;
    out.push({
      company: company,
      hotel: hotel,
      baseSale: baseSale,
      sale: sale,
      nick: nick,
      updatedAt: String(values[i][5] || '')
    });
  }
  return out;
}

function normSale_(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
}
