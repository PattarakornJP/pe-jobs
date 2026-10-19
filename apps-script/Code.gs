/**
 * PE Jobs — ฐานข้อมูลร่วมบน Google Sheet
 *
 * 1) แก้ ADMIN_KEY ด้านล่างเป็นรหัสที่แอดมินใช้กดบันทึก
 * 2) เลือกฟังก์ชัน setup แล้วกดรัน เพื่อสร้างแท็บ jobs และดึงข้อมูลจาก GitHub
 * 3) Deploy > New deployment > Web app
 *    Execute as: Me, Who has access: Anyone
 *
 * GET  = อ่านงานทั้งหมด (คนเปิดเว็บอ่านได้) คืน lastSaved
 * POST = บันทึกทั้งชุด ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ถาม CORS ก่อน
 */

// ★ ใส่รหัสผู้ดูแลตรงนี้ แล้วกดบันทึกไฟล์ แอดมินใช้รหัสนี้ตอนกดปุ่มบันทึกบนเว็บ
var ADMIN_KEY = '';

var SHEET_NAME = 'jobs';
var HEADERS = ['id', 'src', 'so', 'comp', 'proj', 'work', 'pay', 'prog', 'st', 'note', 'eng', 'm', 'y', 'updatedAt'];
var STATUSES = ['รอมัดจำ', 'มัดจำแล้ว', 'พร้อมเข้างาน', 'กำลังดำเนินการ', 'เสร็จแล้ว', 'ไม่ระบุ'];
var SEED_CSV_URL = 'https://raw.githubusercontent.com/PattarakornJP/pe-jobs/main/seed/jobs.csv';
var MAX_ROWS = 5000;

function onOpen() {
  ensureSheet_();
  SpreadsheetApp.getUi()
    .createMenu('PE Jobs')
    .addItem('ตั้งค่าเริ่มต้น', 'setup')
    .addToUi();
}

/** สร้างแท็บ jobs ถ้ายังไม่มี แล้วโหลด seed/jobs.csv จาก GitHub */
function setup() {
  var sheet = ensureSheet_();
  if (sheet.getLastRow() > 1) {
    var ok = uiConfirm_(
      'มีข้อมูลอยู่แล้ว',
      'แท็บ jobs มีข้อมูลอยู่ จะล้างแล้วโหลดชุดเริ่มต้นจากเว็บแทนหรือไม่?'
    );
    if (!ok) return;
  }
  var res = UrlFetchApp.fetch(SEED_CSV_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    uiAlert_(
      'โหลดข้อมูลตั้งต้นไม่ได้',
      'ยังดึงไฟล์จาก GitHub ไม่สำเร็จ (' + res.getResponseCode() + ')\n' +
        'ใช้ไฟล์ > นำเข้า แล้วอัปโหลด seed/jobs.csv ไปที่แท็บ jobs แทน'
    );
    return;
  }
  try {
    var count = importCsv_(sheet, res.getContentText('UTF-8'));
    var now = new Date().toISOString();
    PropertiesService.getScriptProperties().setProperties({
      JOBS_REV: now,
      JOBS_HASH: hashRows_(readRows_())
    });
    uiAlert_('นำเข้าแล้ว', 'นำเข้า ' + count + ' งาน ไปที่แท็บ jobs');
  } catch (err) {
    uiAlert_('นำเข้าไม่สำเร็จ', 'ใช้ไฟล์ > นำเข้า แล้วอัปโหลด seed/jobs.csv ไปที่แท็บ jobs');
  }
}

function doGet(e) {
  e = e || {};
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return emit_(e, { ok: false, error: 'ระบบไม่ว่าง รอสักครู่แล้วกด โหลดใหม่' });
  }
  try {
    var snap = snapshot_();
    return emit_(e, {
      ok: true,
      count: snap.rows.length,
      lastSaved: snap.lastSaved,
      rows: snap.rows
    });
  } catch (err) {
    return emit_(e, { ok: false, error: 'อ่านข้อมูลไม่สำเร็จ ลองกด โหลดใหม่' });
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '');
  } catch (err) {
    return json_({ ok: false, error: 'อ่านข้อมูลที่ส่งมาไม่สำเร็จ ลองกด บันทึก อีกครั้ง' });
  }
  if (!body || typeof body !== 'object') {
    return json_({ ok: false, error: 'ไม่มีข้อมูลให้บันทึก' });
  }

  var adminKey = String(ADMIN_KEY || '').trim();
  if (!adminKey) {
    return json_({
      ok: false,
      auth: false,
      error: 'ยังไม่ได้ตั้งรหัส เปิด Apps Script แล้วใส่รหัสที่บรรทัด ADMIN_KEY ด้านบนของ Code.gs'
    });
  }
  var given = String(body.key || '').trim();
  if (!given || given !== adminKey) {
    return json_({ ok: false, auth: false, error: 'รหัสไม่ถูกต้อง ใส่รหัสใหม่อีกครั้ง แล้วกด บันทึก' });
  }
  if (!Array.isArray(body.rows)) {
    return json_({ ok: false, error: 'ไม่มีรายการงานให้บันทึก' });
  }
  if (!body.rows.length) {
    return json_({ ok: false, error: 'ไม่มีงานเหลืออยู่ จึงยังไม่บันทึก เพื่อกันข้อมูลบนชีตหาย' });
  }
  if (body.rows.length > MAX_ROWS) {
    return json_({ ok: false, error: 'จำนวนงานมากเกินไป จึงยังไม่บันทึก' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'ระบบไม่ว่าง รอสักครู่แล้วกด บันทึก อีกครั้ง' });
  }
  try {
    var current = snapshot_();
    var clientSaved = String(body.lastSaved || body.baseUpdatedAt || '');
    if (!body.force && clientSaved !== String(current.lastSaved || '')) {
      return json_({
        ok: false,
        conflict: true,
        lastSaved: current.lastSaved,
        count: current.rows.length,
        error: 'มีคนอื่นเพิ่งบันทึกข้อมูลใหม่กว่านี้'
      });
    }
    var now = new Date().toISOString();
    var rows = body.rows.map(normalizeRow_);
    writeRows_(rows, now);
    var saved = readRows_();
    PropertiesService.getScriptProperties().setProperties({
      JOBS_REV: now,
      JOBS_HASH: hashRows_(saved)
    });
    return json_({ ok: true, saved: true, count: saved.length, lastSaved: now });
  } catch (err) {
    return json_({ ok: false, error: 'บันทึกไม่สำเร็จ ลองกด บันทึก อีกครั้ง' });
  } finally {
    lock.releaseLock();
  }
}

function ensureSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function snapshot_() {
  var rows = readRows_();
  var hash = hashRows_(rows);
  var props = PropertiesService.getScriptProperties();
  var rev = props.getProperty('JOBS_REV');
  var old = props.getProperty('JOBS_HASH');
  if (!rev || old !== hash) {
    rev = new Date().toISOString();
    props.setProperties({ JOBS_REV: rev, JOBS_HASH: hash });
  }
  return { rows: rows, lastSaved: rev };
}

function readRows_() {
  var sheet = ensureSheet_();
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var header = values[0].map(function (h) { return String(h).replace(/^\uFEFF/, '').trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = {};
    var empty = true;
    for (var c = 0; c < header.length; c++) {
      if (!header[c]) continue;
      var v = values[i][c];
      if (v !== '' && v != null) empty = false;
      obj[header[c]] = v;
    }
    if (empty || (!stringify_(obj.so) && !stringify_(obj.id))) continue;
    rows.push(normalizeRow_(obj));
  }
  return rows;
}

function writeRows_(rows, now) {
  var sheet = ensureSheet_();
  var width = HEADERS.length;
  sheet.getRange(1, 1, 1, width).setValues([HEADERS]).setFontWeight('bold').setNumberFormat('@');
  sheet.setFrozenRows(1);
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, width).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (r) {
    var n = normalizeRow_(r);
    return HEADERS.map(function (h) {
      if (h === 'updatedAt') return now || '';
      var v = n[h];
      return v == null ? '' : String(v);
    });
  });
  var range = sheet.getRange(2, 1, values.length, width);
  range.setNumberFormat('@');
  range.setValues(values);
}

function importCsv_(sheet, text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  var table = Utilities.parseCsv(text);
  if (!table || table.length < 2) throw new Error('empty csv');
  var header = table[0].map(function (h) { return String(h).replace(/^\uFEFF/, '').trim(); });
  var rows = [];
  for (var i = 1; i < table.length; i++) {
    var obj = {};
    for (var c = 0; c < header.length; c++) obj[header[c]] = table[i][c];
    if (!stringify_(obj.so) && !stringify_(obj.id)) continue;
    rows.push(obj);
  }
  writeRows_(rows, '', '');
  return rows.length;
}

function normalizeRow_(r) {
  r = r || {};
  var st = stringify_(r.st);
  if (STATUSES.indexOf(st) < 0) st = 'ไม่ระบุ';
  var eng = stringify_(r.eng) || 'ยังไม่ระบุ';
  return {
    id: Number(r.id) || 0,
    src: stringify_(r.src),
    so: stringify_(r.so),
    comp: stringify_(r.comp),
    proj: stringify_(r.proj),
    work: stringify_(r.work),
    pay: stringify_(r.pay),
    prog: stringify_(r.prog),
    st: st,
    note: stringify_(r.note),
    eng: eng,
    m: clampMonth_(r.m),
    y: Number(r.y) || 0
  };
}

function stringify_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function clampMonth_(v) {
  var n = Number(v) || 0;
  if (n < 0) return 0;
  if (n > 12) return 12;
  return n;
}

function hashRows_(rows) {
  var text = JSON.stringify(rows.map(normalizeRow_));
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function emit_(e, obj) {
  var cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(cb)) {
    return ContentService
      .createTextOutput(cb + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return json_(obj);
}

function uiAlert_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (err) {
    Logger.log(title + ' — ' + message);
  }
}

function uiConfirm_(title, message) {
  var ui = SpreadsheetApp.getUi();
  return ui.alert(title, message, ui.ButtonSet.YES_NO) === ui.Button.YES;
}
