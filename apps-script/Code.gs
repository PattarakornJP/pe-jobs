/**
 * PE Jobs — ฐานข้อมูลร่วมบน Google Sheet
 *
 * 1) แก้ ADMIN_KEY ด้านล่างเป็นรหัสที่แอดมินใช้กดบันทึก
 * 2) เลือกฟังก์ชัน setup แล้วกดรัน เพื่อสร้างแท็บ jobs และดึงข้อมูลจาก GitHub
 * 3) Deploy > New deployment > Web app
 *    Execute as: Me, Who has access: Anyone
 *
 * GET  = อ่านงานทั้งหมด (คนเปิดเว็บอ่านได้) คืน lastSaved
 *        ?table=service อ่านแท็บ service (ไม่ส่ง table = งาน Project เหมือนเดิม)
 * POST = บันทึกทั้งชุด ส่งเป็น text/plain เพื่อไม่ให้เบราว์เซอร์ถาม CORS ก่อน
 *        body.table = 'service' บันทึกลงแท็บ service คนละ rev/hash กับ jobs
 */

// ★ ใส่รหัสผู้ดูแลตรงนี้ แล้วกดบันทึกไฟล์ แอดมินใช้รหัสนี้ตอนกดปุ่มบันทึกบนเว็บ
var ADMIN_KEY = '';

var SHEET_NAME = 'jobs';
var HEADERS = ['id', 'src', 'so', 'comp', 'proj', 'work', 'pay', 'prog', 'st', 'note', 'eng', 'm', 'y', 'loc', 'lat', 'lng', 'locHow', 'locSrc', 'updatedAt'];
var STATUSES = ['รอมัดจำ', 'มัดจำแล้ว', 'พร้อมเข้างาน', 'กำลังดำเนินการ', 'รอส่งมอบงาน', 'เสร็จแล้ว', 'ไม่ระบุ'];
var SEED_CSV_URL = 'https://raw.githubusercontent.com/PattarakornJP/pe-jobs/main/seed/jobs.csv';
var SERVICE_SHEET_NAME = 'service';
var SERVICE_HEADERS = ['id', 'no', 'date', 'customer', 'detail', 'type', 'chkWait', 'chkDone', 'rptWait', 'rptDone', 'sales', 'so', 'depWait', 'depDone', 'partsWait', 'partsDone', 'enterWait', 'enterDone', 'workDate', 'workOpen', 'workDone', 'team', 'note', 'loc', 'lat', 'lng', 'locHow', 'locSrc', 'updatedAt'];
var SERVICE_FLAGS = ['chkWait', 'chkDone', 'rptWait', 'rptDone', 'depWait', 'depDone', 'partsWait', 'partsDone', 'enterWait', 'enterDone', 'workOpen', 'workDone'];
var SERVICE_SEED_CSV_URL = 'https://raw.githubusercontent.com/PattarakornJP/pe-jobs/main/seed/service.csv';
var MAX_ROWS = 5000;

function onOpen() {
  ensureSheet_();
  ensureServiceSheet_();
  SpreadsheetApp.getUi()
    .createMenu('PE Jobs')
    .addItem('ตั้งค่าเริ่มต้น', 'setup')
    .addItem('นำเข้างาน Service', 'importServiceSeed')
    .addToUi();
}

/** สร้างแท็บ jobs ถ้ายังไม่มี แล้วโหลด seed/jobs.csv จาก GitHub
 *  ถ้าแท็บ service ยังว่าง จะโหลด seed/service.csv ให้ด้วย (ไม่ล้างของเดิม) */
function setup() {
  var svcNote = '';
  try { svcNote = importServiceIfEmpty_(); } catch (err) { svcNote = ''; }
  var sheet = ensureSheet_();
  if (sheet.getLastRow() > 1) {
    var ok = uiConfirm_(
      'มีข้อมูลอยู่แล้ว',
      'แท็บ jobs มีข้อมูลอยู่ จะล้างแล้วโหลดชุดเริ่มต้นจากเว็บแทนหรือไม่?'
    );
    if (!ok) {
      if (svcNote) uiAlert_('งาน Service', svcNote);
      return;
    }
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
    uiAlert_('นำเข้าแล้ว', 'นำเข้า ' + count + ' งาน ไปที่แท็บ jobs' + (svcNote ? '\n' + svcNote : ''));
  } catch (err) {
    uiAlert_('นำเข้าไม่สำเร็จ', 'ใช้ไฟล์ > นำเข้า แล้วอัปโหลด seed/jobs.csv ไปที่แท็บ jobs');
  }
}

function doGet(e) {
  e = e || {};
  if (requestedTable_(e && e.parameter) === 'service') return doGetService_(e);
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
  if (requestedTable_(body) === 'service') return postService_(body);

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

function requestedTable_(obj) {
  var t = obj && obj.table;
  t = String(t || '').trim().toLowerCase();
  return t === 'service' ? 'service' : 'jobs';
}

function doGetService_(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return emit_(e, { ok: false, table: 'service', error: 'ระบบไม่ว่าง รอสักครู่แล้วกด โหลดใหม่' });
  }
  try {
    var snap = snapshotService_();
    return emit_(e, {
      ok: true,
      table: 'service',
      count: snap.rows.length,
      lastSaved: snap.lastSaved,
      rows: snap.rows
    });
  } catch (err) {
    return emit_(e, { ok: false, table: 'service', error: 'อ่านข้อมูลไม่สำเร็จ ลองกด โหลดใหม่' });
  } finally {
    lock.releaseLock();
  }
}

function postService_(body) {
  var adminKey = String(ADMIN_KEY || '').trim();
  if (!adminKey) {
    return json_({
      ok: false,
      table: 'service',
      auth: false,
      error: 'ยังไม่ได้ตั้งรหัส เปิด Apps Script แล้วใส่รหัสที่บรรทัด ADMIN_KEY ด้านบนของ Code.gs'
    });
  }
  var given = String(body.key || '').trim();
  if (!given || given !== adminKey) {
    return json_({ ok: false, table: 'service', auth: false, error: 'รหัสไม่ถูกต้อง ใส่รหัสใหม่อีกครั้ง แล้วกด บันทึก' });
  }
  if (!Array.isArray(body.rows)) {
    return json_({ ok: false, table: 'service', error: 'ไม่มีรายการงานให้บันทึก' });
  }
  if (!body.rows.length) {
    return json_({ ok: false, table: 'service', error: 'ไม่มีงานเหลืออยู่ จึงยังไม่บันทึก เพื่อกันข้อมูลบนชีตหาย' });
  }
  if (body.rows.length > MAX_ROWS) {
    return json_({ ok: false, table: 'service', error: 'จำนวนงานมากเกินไป จึงยังไม่บันทึก' });
  }
  if (payloadLooksLikeJobs_(body.rows)) {
    return json_({ ok: false, table: 'service', error: 'ข้อมูลนี้เป็นงาน Project จึงยังไม่บันทึกลงแท็บ service' });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, table: 'service', error: 'ระบบไม่ว่าง รอสักครู่แล้วกด บันทึก อีกครั้ง' });
  }
  try {
    var current = snapshotService_();
    var clientSaved = String(body.lastSaved || body.baseUpdatedAt || '');
    if (!body.force && clientSaved !== String(current.lastSaved || '')) {
      return json_({
        ok: false,
        table: 'service',
        conflict: true,
        lastSaved: current.lastSaved,
        count: current.rows.length,
        error: 'มีคนอื่นเพิ่งบันทึกข้อมูลใหม่กว่านี้'
      });
    }
    var now = new Date().toISOString();
    var rows = body.rows.map(normalizeServiceRow_);
    writeServiceRows_(rows, now);
    var saved = readServiceRows_();
    PropertiesService.getScriptProperties().setProperties({
      SERVICE_REV: now,
      SERVICE_HASH: hashServiceRows_(saved)
    });
    return json_({ ok: true, table: 'service', saved: true, count: saved.length, lastSaved: now });
  } catch (err) {
    return json_({ ok: false, table: 'service', error: 'บันทึกไม่สำเร็จ ลองกด บันทึก อีกครั้ง' });
  } finally {
    lock.releaseLock();
  }
}

/** โหลด seed/service.csv เมื่อแท็บ service ยังไม่มีข้อมูล ไม่ล้างของเดิม */
function importServiceIfEmpty_() {
  var sheet = ensureServiceSheet_();
  if (sheet.getLastRow() > 1) return '';
  var res = UrlFetchApp.fetch(SERVICE_SEED_CSV_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) return '';
  var count = importServiceCsv_(sheet, res.getContentText('UTF-8'));
  stampService_();
  return 'นำเข้า ' + count + ' งาน ไปที่แท็บ service';
}

/** เมนู PE Jobs → นำเข้างาน Service */
function importServiceSeed() {
  var sheet = ensureServiceSheet_();
  if (sheet.getLastRow() > 1) {
    var ok = uiConfirm_(
      'มีข้อมูล Service อยู่แล้ว',
      'แท็บ service มีข้อมูลอยู่ จะล้างแล้วโหลดชุดเริ่มต้นจากเว็บแทนหรือไม่?'
    );
    if (!ok) return;
  }
  var res = UrlFetchApp.fetch(SERVICE_SEED_CSV_URL, { muteHttpExceptions: true, followRedirects: true });
  if (res.getResponseCode() !== 200) {
    uiAlert_(
      'โหลดข้อมูลตั้งต้นไม่ได้',
      'ยังดึงไฟล์จาก GitHub ไม่สำเร็จ (' + res.getResponseCode() + ')\n' +
        'ใช้ไฟล์ > นำเข้า แล้วอัปโหลด seed/service.csv ไปที่แท็บ service แทน'
    );
    return;
  }
  try {
    var count = importServiceCsv_(sheet, res.getContentText('UTF-8'));
    stampService_();
    uiAlert_('นำเข้าแล้ว', 'นำเข้า ' + count + ' งาน ไปที่แท็บ service');
  } catch (err) {
    uiAlert_('นำเข้าไม่สำเร็จ', 'ใช้ไฟล์ > นำเข้า แล้วอัปโหลด seed/service.csv ไปที่แท็บ service');
  }
}

function stampService_() {
  var now = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperties({
    SERVICE_REV: now,
    SERVICE_HASH: hashServiceRows_(readServiceRows_())
  });
}

function ensureServiceSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SERVICE_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SERVICE_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SERVICE_HEADERS.length).setValues([SERVICE_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function snapshotService_() {
  var rows = readServiceRows_();
  var hash = hashServiceRows_(rows);
  var props = PropertiesService.getScriptProperties();
  var rev = props.getProperty('SERVICE_REV');
  var old = props.getProperty('SERVICE_HASH');
  if (!rev || old !== hash) {
    rev = new Date().toISOString();
    props.setProperties({ SERVICE_REV: rev, SERVICE_HASH: hash });
  }
  return { rows: rows, lastSaved: rev };
}

function readServiceRows_() {
  var sheet = ensureServiceSheet_();
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
    if (empty) continue;
    if (!stringify_(obj.id) && !stringify_(obj.customer) && !stringify_(obj.detail) && !stringify_(obj.so)) continue;
    rows.push(normalizeServiceRow_(obj));
  }
  return rows;
}

function writeServiceRows_(rows, now) {
  var sheet = ensureServiceSheet_();
  var width = SERVICE_HEADERS.length;
  sheet.getRange(1, 1, 1, width).setValues([SERVICE_HEADERS]).setFontWeight('bold').setNumberFormat('@');
  sheet.setFrozenRows(1);
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, Math.max(width, sheet.getLastColumn())).clearContent();
  if (!rows.length) return;
  var values = rows.map(function (r) {
    var n = normalizeServiceRow_(r);
    return SERVICE_HEADERS.map(function (h) {
      if (h === 'updatedAt') return now || '';
      var v = n[h];
      return v == null ? '' : String(v);
    });
  });
  var range = sheet.getRange(2, 1, values.length, width);
  range.setNumberFormat('@');
  range.setValues(values);
}

function importServiceCsv_(sheet, text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  var table = Utilities.parseCsv(text);
  if (!table || table.length < 2) throw new Error('empty csv');
  var header = table[0].map(function (h) { return String(h).replace(/^\uFEFF/, '').trim(); });
  var rows = [];
  for (var i = 1; i < table.length; i++) {
    var obj = {};
    var any = false;
    for (var c = 0; c < header.length; c++) {
      obj[header[c]] = table[i][c];
      if (stringify_(table[i][c])) any = true;
    }
    if (!any) continue;
    if (!stringify_(obj.id) && !stringify_(obj.customer) && !stringify_(obj.detail) && !stringify_(obj.so)) continue;
    rows.push(obj);
  }
  writeServiceRows_(rows, '');
  return rows.length;
}

function normalizeServiceRow_(r) {
  r = r || {};
  var dateIso = parseDateToIso_(r.date);
  var workIso = parseDateToIso_(r.workDate);
  var workRaw = serviceText_(r.workDate);
  var out = {
    id: Number(r.id) || 0,
    no: Number(r.no) || 0,
    date: dateIso || serviceText_(r.date),
    customer: serviceText_(r.customer),
    detail: serviceText_(r.detail),
    type: normServiceType_(r.type),
    sales: serviceText_(r.sales),
    so: serviceText_(r.so),
    workDate: workIso || workRaw,
    team: serviceText_(r.team),
    note: serviceText_(r.note),
    loc: serviceText_(r.loc),
    lat: coord_(r.lat),
    lng: coord_(r.lng),
    locHow: locHow_(r.locHow),
    locSrc: serviceText_(r.locSrc)
  };
  for (var i = 0; i < SERVICE_FLAGS.length; i++) {
    out[SERVICE_FLAGS[i]] = flag_(r[SERVICE_FLAGS[i]]);
  }
  return out;
}

function normServiceType_(v) {
  var s = serviceText_(v);
  if (s === 'PM (บำรุงรักษา)') return 'PM';
  return s;
}

function serviceText_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    var iso = parseDateToIso_(v);
    if (!iso) return '';
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + (Number(p[0]) + 543);
  }
  return String(v).replace(/^\uFEFF/, '').trim();
}

function flag_(v) {
  if (v === true || v === 1) return 1;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'ใช่') return 1;
  return 0;
}

function parseDateToIso_(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    var y = v.getFullYear();
    var m = v.getMonth() + 1;
    var d = v.getDate();
    if (y >= 2400) y -= 543;
    return pad4_(y) + '-' + pad2_(m) + '-' + pad2_(d);
  }
  var s = String(v).replace(/^\uFEFF/, '').trim();
  if (s === '23/92/569') return '2026-09-23';
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    var yi = Number(iso[1]);
    if (yi >= 2400) yi -= 543;
    return pad4_(yi) + '-' + iso[2] + '-' + iso[3];
  }
  var dm = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!dm) return '';
  var dd = Number(dm[1]);
  var mm = Number(dm[2]);
  var yy = Number(dm[3]);
  if (yy < 100) yy = yy >= 50 ? 2500 + yy : 2000 + yy;
  if (yy >= 2400) yy -= 543;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  return pad4_(yy) + '-' + pad2_(mm) + '-' + pad2_(dd);
}

function pad2_(n) {
  n = Number(n) || 0;
  return (n < 10 ? '0' : '') + n;
}

function pad4_(n) {
  n = Number(n) || 0;
  var s = String(n);
  while (s.length < 4) s = '0' + s;
  return s;
}

function hashServiceRows_(rows) {
  var text = JSON.stringify((rows || []).map(normalizeServiceRow_));
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return (v < 16 ? '0' : '') + v.toString(16);
  }).join('');
}

function payloadLooksLikeJobs_(rows) {
  if (!rows || !rows.length) return false;
  var jobsLike = 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i] || {};
    var hasJob = r.comp != null && String(r.comp) !== '' && r.customer == null && r.detail == null;
    if (hasJob) jobsLike++;
  }
  return jobsLike === rows.length;
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
    y: Number(r.y) || 0,
    loc: stringify_(r.loc),
    lat: coord_(r.lat),
    lng: coord_(r.lng),
    locHow: locHow_(r.locHow),
    locSrc: stringify_(r.locSrc)
  };
}

function coord_(v) {
  if (v == null || v === '') return '';
  var n = Number(v);
  if (!isFinite(n)) return '';
  return String(n);
}

function locHow_(v) {
  var s = stringify_(v);
  if (s === 'exact') return 'exact';
  if (s === 'approximate' || s === 'fuzzy') return 'approximate';
  return '';
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
