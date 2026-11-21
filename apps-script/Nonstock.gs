/**
 * PE Jobs — วัสดุงานติดตั้งนอกสต๊อก (ไฟล์แยกจาก Code.gs ใช้ร่วมกันในโปรเจกต์ Apps Script เดียวกัน)
 *
 * ใช้ตัวช่วยจาก Code.gs: ADMIN_KEY, MAX_ROWS, emit_, json_, stringify_, parseDateToIso_, uiAlert_, uiConfirm_
 * Code.gs ส่งต่อมาที่นี่ 2 จุด: doGet (table=nonstock) → doGetNonstock_, doPost (table=nonstock) → postNonstock_
 *
 * แท็บในชีต
 *   nonstock        รายการเคลื่อนไหว (เบิกใช้ / คืนคลัง / รับเข้าเพิ่ม)
 *   nonstock_items  รายการวัสดุที่แอดมินเพิ่มหรือแก้ (ทับข้อมูลตั้งต้นใน data/nonstock.json ตาม id) ลบแบบซ่อน deleted=1
 *   nonstock_cats   หมวดที่เพิ่ม เปลี่ยนชื่อ หรือซ่อน (ทับหมวดตั้งต้นตาม id)
 *   nonstock_imgs   รูปที่อัปโหลดจากเว็บ (JPEG ย่อแล้ว เก็บเป็น data URL แบ่งหลายช่อง ไม่ต้องใช้ Google Drive)
 *
 * GET  ?table=nonstock            → { rows, items, cats, lastSaved }
 * GET  ?table=nonstock&img=<id>   → { img: { id, data } }
 * POST { table:'nonstock', expect:'nonstock', key, ops:[...] }
 *      op = { op:'upsert'|'delete', kind:'move'|'item'|'cat'|'img', row | id }  (ไม่ใส่ kind = move)
 */

var NONSTOCK_SHEET_NAME = 'nonstock';
var NONSTOCK_HEADERS = ['id', 'itemId', 'cat', 'code', 'name', 'unit', 'type', 'date', 'qty', 'so', 'project', 'by', 'doc', 'note', 'src', 'updatedAt'];
var NONSTOCK_TYPES = ['out', 'ret', 'in', 'item'];
var NONSTOCK_SEED_URL = 'https://raw.githubusercontent.com/PattarakornJP/pe-jobs/main/data/nonstock.json';
var NONSTOCK_ITEMS_SHEET = 'nonstock_items';
var NONSTOCK_ITEM_HEADERS = ['id', 'cat', 'code', 'name', 'unit', 'qtyIn', 'recv', 'note', 'img', 'imgSrc', 'deleted', 'updatedAt'];
var NONSTOCK_CATS_SHEET = 'nonstock_cats';
var NONSTOCK_CAT_HEADERS = ['id', 'name', 'order', 'deleted', 'updatedAt'];
var NONSTOCK_IMGS_SHEET = 'nonstock_imgs';
var NONSTOCK_IMG_PARTS = 8;
var NONSTOCK_IMG_CHUNK = 45000;
var NONSTOCK_IMG_HEADERS = (function () {
  var h = ['id', 'updatedAt'];
  for (var i = 1; i <= NONSTOCK_IMG_PARTS; i++) h.push('p' + i);
  return h;
})();

function doGetNonstock_(e) {
  var p = (e && e.parameter) || {};
  if (p.img) {
    try {
      var data = readNonstockImg_(String(p.img));
      return emit_(e, { ok: !!data, table: 'nonstock', img: data ? { id: String(p.img), data: data } : null, error: data ? '' : 'ไม่พบรูป' });
    } catch (err) {
      return emit_(e, { ok: false, table: 'nonstock', error: 'อ่านรูปไม่สำเร็จ' });
    }
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return emit_(e, { ok: false, table: 'nonstock', error: 'ระบบไม่ว่าง รอสักครู่แล้วลองใหม่' });
  }
  try {
    var seeded = '';
    try { seeded = importNonstockIfEmpty_(); } catch (err) { seeded = ''; }
    var snap = snapshotNonstock_();
    return emit_(e, {
      ok: true,
      table: 'nonstock',
      count: snap.rows.length,
      lastSaved: snap.lastSaved,
      seeded: !!seeded,
      fields: NONSTOCK_HEADERS,
      rows: snap.rows,
      items: readNonstockItems_(),
      cats: readNonstockCats_()
    });
  } catch (err) {
    return emit_(e, { ok: false, table: 'nonstock', error: 'อ่านข้อมูลไม่สำเร็จ ลองโหลดใหม่' });
  } finally {
    lock.releaseLock();
  }
}

function postNonstock_(body) {
  if (String(body.expect || '') !== 'nonstock') {
    return json_({ ok: false, table: 'nonstock', error: 'คำขอไม่ครบ จึงยังไม่บันทึก' });
  }
  var adminKey = String(ADMIN_KEY || '').trim();
  if (!adminKey) {
    return json_({ ok: false, table: 'nonstock', auth: false, error: 'ยังไม่ได้ตั้งรหัส เปิด Apps Script แล้วใส่รหัสที่บรรทัด ADMIN_KEY ด้านบนของ Code.gs' });
  }
  var given = String(body.key || '').trim();
  if (!given || given !== adminKey) {
    return json_({ ok: false, table: 'nonstock', auth: false, error: 'รหัสไม่ถูกต้อง ใส่รหัสใหม่อีกครั้ง' });
  }
  var ops = Array.isArray(body.ops) ? body.ops : null;
  if (!ops || !ops.length) {
    return json_({ ok: false, table: 'nonstock', error: 'ไม่มีรายการให้บันทึก' });
  }
  if (ops.length > MAX_ROWS) {
    return json_({ ok: false, table: 'nonstock', error: 'จำนวนรายการมากเกินไป จึงยังไม่บันทึก' });
  }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, table: 'nonstock', error: 'ระบบไม่ว่าง รอสักครู่แล้วลองใหม่' });
  }
  try {
    try { importNonstockIfEmpty_(); } catch (err) {}
    var now = new Date().toISOString();
    var rows = null, items = null, cats = null;
    var applied = 0;
    var skipped = [];
    for (var i = 0; i < ops.length; i++) {
      var op = ops[i] || {};
      var kind = String(op.kind || 'move');
      if (kind === 'img') {
        if (op.op === 'delete') { deleteNonstockImg_(stringify_(op.id)); applied++; }
        else if (op.op === 'upsert' && op.row && op.row.id && op.row.data) {
          if (writeNonstockImg_(stringify_(op.row.id), String(op.row.data), now)) applied++;
          else skipped.push(stringify_(op.row.id));
        }
        continue;
      }
      if (kind === 'item') {
        if (!items) items = readNonstockItems_();
        applied += applyNonstockOp_(items, op, normalizeNonstockItem_, now);
        continue;
      }
      if (kind === 'cat') {
        if (!cats) cats = readNonstockCats_();
        applied += applyNonstockOp_(cats, op, normalizeNonstockCat_, now);
        continue;
      }
      if (!rows) rows = readNonstockRows_();
      if (op.op === 'delete') {
        var id = stringify_(op.id);
        var before = rows.length;
        rows = rows.filter(function (r) { return r.id !== id; });
        if (rows.length !== before) applied++;
      } else if (op.op === 'upsert' && op.row) {
        var n = normalizeNonstockRow_(op.row);
        if (!n.id || !n.itemId) continue;
        n.updatedAt = now;
        var found = -1;
        for (var j = 0; j < rows.length; j++) if (rows[j].id === n.id) { found = j; break; }
        if (found >= 0) rows[found] = n; else rows.push(n);
        applied++;
      }
    }
    if (rows) writeNonstockRows_(rows);
    if (items) writeNonstockTable_(NONSTOCK_ITEMS_SHEET, NONSTOCK_ITEM_HEADERS, items);
    if (cats) writeNonstockTable_(NONSTOCK_CATS_SHEET, NONSTOCK_CAT_HEADERS, cats);
    var saved = readNonstockRows_();
    PropertiesService.getScriptProperties().setProperties({
      NONSTOCK_REV: now,
      NONSTOCK_HASH: hashNonstockRows_(saved),
      NONSTOCK_SEEDED: '1'
    });
    return json_({
      ok: true, table: 'nonstock', saved: true, applied: applied, skippedImgs: skipped, count: saved.length, lastSaved: now,
      rows: saved, items: readNonstockItems_(), cats: readNonstockCats_()
    });
  } catch (err) {
    return json_({ ok: false, table: 'nonstock', error: 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง' });
  } finally {
    lock.releaseLock();
  }
}

/** upsert ทับทั้งแถวตาม id · delete ลบแถวออก (หน้าเว็บใช้ upsert deleted=1 สำหรับลบแบบซ่อน) */
function applyNonstockOp_(list, op, norm, now) {
  if (op.op === 'delete') {
    var id = stringify_(op.id);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); return 1; }
    return 0;
  }
  if (op.op !== 'upsert' || !op.row) return 0;
  var n = norm(op.row);
  if (!n.id) return 0;
  n.updatedAt = now;
  for (var j = 0; j < list.length; j++) if (list[j].id === n.id) { list[j] = n; return 1; }
  list.push(n);
  return 1;
}

function importNonstockIfEmpty_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('NONSTOCK_SEEDED')) return '';
  var sheet = ensureNonstockSheet_();
  if (sheet.getLastRow() > 1) {
    props.setProperty('NONSTOCK_SEEDED', '1');
    return '';
  }
  var count = loadNonstockSeed_();
  props.setProperty('NONSTOCK_SEEDED', '1');
  return 'นำเข้าการเบิกจากไฟล์ ' + count + ' รายการ ไปที่แท็บ nonstock';
}

/** เมนู/รันเอง: ล้างแท็บ nonstock แล้วโหลดการเบิกจากไฟล์ Excel ใหม่ (ไม่แตะรายการ หมวด และรูปที่แอดมินเพิ่ม) */
function importNonstockSeed() {
  var sheet = ensureNonstockSheet_();
  if (sheet.getLastRow() > 1) {
    var ok = uiConfirm_('มีประวัติเบิกอยู่แล้ว', 'แท็บ nonstock มีข้อมูลอยู่ จะล้างแล้วโหลดการเบิกจากไฟล์ Excel ใหม่หรือไม่?');
    if (!ok) return;
  }
  try {
    var count = loadNonstockSeed_();
    PropertiesService.getScriptProperties().setProperty('NONSTOCK_SEEDED', '1');
    uiAlert_('นำเข้าแล้ว', 'นำเข้าการเบิก ' + count + ' รายการ ไปที่แท็บ nonstock');
  } catch (err) {
    uiAlert_('นำเข้าไม่สำเร็จ', 'ดึงไฟล์ data/nonstock.json จาก GitHub ไม่ได้ ลองใหม่อีกครั้ง');
  }
}

function loadNonstockSeed_() {
  var res = UrlFetchApp.fetch(NONSTOCK_SEED_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) throw new Error('seed ' + res.getResponseCode());
  var data = JSON.parse(String(res.getContentText('UTF-8') || '').replace(/^\uFEFF/, ''));
  var items = {};
  (data.items || []).forEach(function (it) { items[it.id] = it; });
  var rows = (data.seedMoves || []).map(function (m) {
    var it = items[m.itemId] || {};
    var r = {};
    for (var k in m) r[k] = m[k];
    r.cat = it.cat || m.cat;
    r.code = it.code || m.code;
    r.name = it.name || m.name;
    r.unit = it.unit || m.unit;
    return normalizeNonstockRow_(r);
  });
  writeNonstockRows_(rows);
  var now = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperties({ NONSTOCK_REV: now, NONSTOCK_HASH: hashNonstockRows_(readNonstockRows_()) });
  return rows.length;
}

function ensureNonstockTab_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureNonstockSheet_() {
  return ensureNonstockTab_(NONSTOCK_SHEET_NAME, NONSTOCK_HEADERS);
}

function snapshotNonstock_() {
  var rows = readNonstockRows_();
  var hash = hashNonstockRows_(rows);
  var props = PropertiesService.getScriptProperties();
  var rev = props.getProperty('NONSTOCK_REV');
  var old = props.getProperty('NONSTOCK_HASH');
  if (!rev || old !== hash) {
    rev = new Date().toISOString();
    props.setProperties({ NONSTOCK_REV: rev, NONSTOCK_HASH: hash });
  }
  return { rows: rows, lastSaved: rev };
}

function readNonstockObjects_(name, headers) {
  var sheet = ensureNonstockTab_(name, headers);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).replace(/^\uFEFF/, '').trim(); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      var v = values[i][c];
      if (v !== '' && v != null) empty = false;
      obj[header[c]] = v;
    }
    if (!empty) out.push(obj);
  }
  return out;
}

function writeNonstockTable_(name, headers, rows) {
  var sheet = ensureNonstockTab_(name, headers);
  var width = headers.length;
  sheet.getRange(1, 1, 1, width).setValues([headers]).setFontWeight('bold').setNumberFormat('@');
  sheet.setFrozenRows(1);
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (r) {
    return headers.map(function (h) { var v = r[h]; return v == null ? '' : String(v); });
  });
  var range = sheet.getRange(2, 1, values.length, width);
  range.setNumberFormat('@');
  range.setValues(values);
}

function readNonstockRows_() {
  return readNonstockObjects_(NONSTOCK_SHEET_NAME, NONSTOCK_HEADERS).map(function (obj) {
    var n = normalizeNonstockRow_(obj);
    n.updatedAt = stringify_(obj.updatedAt);
    return n;
  }).filter(function (n) { return n.id && n.itemId; });
}

function writeNonstockRows_(rows) {
  rows = rows.slice().sort(function (a, b) {
    return String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id));
  });
  writeNonstockTable_(NONSTOCK_SHEET_NAME, NONSTOCK_HEADERS, rows.map(function (r) {
    var n = normalizeNonstockRow_(r);
    n.updatedAt = stringify_(r.updatedAt);
    return n;
  }));
}

function readNonstockItems_() {
  return readNonstockObjects_(NONSTOCK_ITEMS_SHEET, NONSTOCK_ITEM_HEADERS).map(function (o) {
    var n = normalizeNonstockItem_(o);
    n.updatedAt = stringify_(o.updatedAt);
    return n;
  }).filter(function (n) { return n.id; });
}

function readNonstockCats_() {
  return readNonstockObjects_(NONSTOCK_CATS_SHEET, NONSTOCK_CAT_HEADERS).map(function (o) {
    var n = normalizeNonstockCat_(o);
    n.updatedAt = stringify_(o.updatedAt);
    return n;
  }).filter(function (n) { return n.id; });
}

function nonstockNum_(v) {
  var q = parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
  if (!isFinite(q)) return 0;
  return Math.round(Math.abs(q) * 1000) / 1000;
}

function nonstockFlag_(v) {
  if (v === true || v === 1) return 1;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  return (s === '1' || s === 'true' || s === 'yes') ? 1 : 0;
}

function normalizeNonstockItem_(r) {
  r = r || {};
  var img = stringify_(r.img);
  if (img && !/^(img\/|sheet:|https:\/\/)/.test(img)) img = '';
  return {
    id: stringify_(r.id),
    cat: stringify_(r.cat),
    code: stringify_(r.code),
    name: stringify_(r.name),
    unit: stringify_(r.unit),
    qtyIn: nonstockNum_(r.qtyIn),
    recv: parseDateToIso_(r.recv),
    note: stringify_(r.note),
    img: img,
    imgSrc: img ? (['file', 'web', 'similar', 'admin'].indexOf(stringify_(r.imgSrc)) >= 0 ? stringify_(r.imgSrc) : 'admin') : '',
    deleted: nonstockFlag_(r.deleted)
  };
}

function normalizeNonstockCat_(r) {
  r = r || {};
  var order = parseFloat(r.order);
  return {
    id: stringify_(r.id),
    name: stringify_(r.name),
    order: isFinite(order) ? order : '',
    deleted: nonstockFlag_(r.deleted)
  };
}

function normalizeNonstockRow_(r) {
  r = r || {};
  var type = stringify_(r.type);
  if (NONSTOCK_TYPES.indexOf(type) < 0) type = 'out';
  return {
    id: stringify_(r.id),
    itemId: stringify_(r.itemId),
    cat: stringify_(r.cat),
    code: stringify_(r.code),
    name: stringify_(r.name),
    unit: stringify_(r.unit),
    type: type,
    date: parseDateToIso_(r.date),
    qty: nonstockNum_(r.qty),
    so: stringify_(r.so),
    project: stringify_(r.project),
    by: stringify_(r.by),
    doc: stringify_(r.doc),
    note: stringify_(r.note),
    src: stringify_(r.src) || 'web'
  };
}

function hashNonstockRows_(rows) {
  var text = JSON.stringify((rows || []).map(normalizeNonstockRow_));
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

// ----- รูป: data URL ของ JPEG ที่หน้าเว็บย่อแล้ว แบ่งเก็บหลายช่อง (ช่องละไม่เกิน 45,000 ตัวอักษร) -----

function findNonstockImgRow_(sheet, id) {
  var last = sheet.getLastRow();
  if (last < 2) return -1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function writeNonstockImg_(id, data, now) {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(data)) return false;
  if (data.length > NONSTOCK_IMG_PARTS * NONSTOCK_IMG_CHUNK) return false;
  var sheet = ensureNonstockTab_(NONSTOCK_IMGS_SHEET, NONSTOCK_IMG_HEADERS);
  var row = [id, now];
  for (var i = 0; i < NONSTOCK_IMG_PARTS; i++) row.push(data.substr(i * NONSTOCK_IMG_CHUNK, NONSTOCK_IMG_CHUNK));
  var at = findNonstockImgRow_(sheet, id);
  if (at < 0) at = Math.max(sheet.getLastRow(), 1) + 1;
  var range = sheet.getRange(at, 1, 1, row.length);
  range.setNumberFormat('@');
  range.setValues([row]);
  return true;
}

function readNonstockImg_(id) {
  var sheet = ensureNonstockTab_(NONSTOCK_IMGS_SHEET, NONSTOCK_IMG_HEADERS);
  var at = findNonstockImgRow_(sheet, id);
  if (at < 0) return '';
  var vals = sheet.getRange(at, 3, 1, NONSTOCK_IMG_PARTS).getValues()[0];
  return vals.map(function (v) { return String(v == null ? '' : v); }).join('');
}

function deleteNonstockImg_(id) {
  var sheet = ensureNonstockTab_(NONSTOCK_IMGS_SHEET, NONSTOCK_IMG_HEADERS);
  var at = findNonstockImgRow_(sheet, id);
  if (at > 0) sheet.deleteRow(at);
}
