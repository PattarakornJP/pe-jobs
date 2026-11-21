/* แท็บ วัสดุนอกสต๊อก — รายการวัสดุงานติดตั้งนอกสต๊อก แยกหมวดตามชีต ตัดยอดตามการเบิก แสดงคงเหลือ */
(function (root) {
  'use strict';
  var M = root.PEStockModel;
  var DATA_URL = 'data/nonstock.json';
  var PENDING_KEY = 'pe-nonstock-pending-v1';
  var CACHE_KEY = 'pe-nonstock-cache-v1';
  var bridge = {};
  var master = null;          // { categories, items, seedMoves, fileNotes }
  var serverMoves = [];
  var pending = [];
  var mode = 'loading';       // loading | live | local
  var lastSaved = '';
  var lastLoad = 0;
  var flushing = false;
  var flushTimer = null;
  var retryTimer = null;
  var needKey = false;
  var statusMsg = '';
  var statusWarn = false;
  var booted = false;
  var rowsCache = [];
  var f = { cat: '', q: '', st: '', sort: 'file' };
  var histLimit = 40;
  var editing = null;         // { id, fixedItem, kind }

  function $(s, r) { return (r || document).querySelector(s); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtN(n) {
    var v = Math.round(n * 1000) / 1000;
    return v.toLocaleString('th-TH', { maximumFractionDigits: 3 });
  }
  function todayIso() { return M.isoDate(new Date()); }
  function fmtTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try { return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return d.toLocaleString('th-TH'); }
  }
  function catName(id) {
    var c = (master && master.categories || []).find(function (x) { return x.id === id; });
    return c ? c.name : id;
  }

  // ---------- เก็บในเครื่อง ----------
  function loadPending() {
    try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || []; } catch (e) { pending = []; }
    if (!Array.isArray(pending)) pending = [];
  }
  function savePending() {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) {}
  }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ rows: serverMoves, lastSaved: lastSaved })); } catch (e) {}
  }
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch (e) { return null; }
  }

  function moves() { return M.applyOps(serverMoves, pending); }
  function compute() {
    rowsCache = M.balances(master.items, moves());
    return rowsCache;
  }

  // ---------- โหลด ----------
  async function boot() {
    if (booted) return;
    booted = true;
    renderShell();
    loadPending();
    try {
      var res = await fetch(DATA_URL, { cache: 'no-store' });
      master = await res.json();
    } catch (e) {
      $('#stkRoot').innerHTML = '<div class="banner on bad">โหลดรายการวัสดุไม่ได้ ลองรีเฟรชหน้าอีกครั้ง</div>';
      return;
    }
    var cache = readCache();
    serverMoves = (cache && cache.rows) || master.seedMoves.map(M.normalizeMove);
    renderAll();
    await reload();
  }

  async function reload() {
    var shared = bridge.shared ? bridge.shared() : false;
    if (!shared || !bridge.apiGet) { goLocal(); return; }
    setStatus('กำลังโหลดจากชีต…', false);
    try {
      var data = await bridge.apiGet('nonstock');
      if (data && data.ok && data.table === 'nonstock' && Array.isArray(data.rows)) {
        mode = 'live';
        serverMoves = data.rows.map(M.normalizeMove);
        lastSaved = data.lastSaved || '';
        lastLoad = Date.now();
        saveCache();
        setStatus(pending.length ? ('รอส่งขึ้นชีต ' + pending.length + ' รายการ') : (lastSaved ? 'บันทึกล่าสุด ' + fmtTime(lastSaved) : 'โหลดจากชีตแล้ว'), !!pending.length);
        renderAll();
        if (pending.length) scheduleFlush(50);
        return;
      }
      if (data && data.ok === false && data.table === 'nonstock') {
        setStatus(data.error || 'โหลดจากชีตไม่สำเร็จ', true);
        renderAll();
        return;
      }
      goLocal();
    } catch (e) {
      setStatus('ต่อชีตไม่ได้ ใช้ข้อมูลล่าสุดในเครื่องนี้', true);
      if (mode === 'loading') mode = 'offline';
      renderAll();
    }
  }

  function goLocal() {
    mode = 'local';
    serverMoves = master.seedMoves.map(M.normalizeMove);
    setStatus(pending.length ? ('บันทึกไว้ในเครื่องนี้ ' + pending.length + ' รายการ') : 'ข้อมูลตามไฟล์ Excel', !!pending.length);
    renderAll();
  }

  // ---------- บันทึกอัตโนมัติ ----------
  function queue(op) {
    pending.push(op);
    savePending();
    renderAll();
    kick();
  }
  function kick() {
    if (mode === 'live') {
      setStatus('กำลังบันทึก…', false);
      if (bridge.getKey && !bridge.getKey()) flush(true);
      else scheduleFlush(400);
    } else {
      setStatus('บันทึกไว้ในเครื่องนี้ ' + pending.length + ' รายการ', true);
    }
  }
  function scheduleFlush(ms) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flush(false); }, ms);
  }
  async function flush(interactive) {
    if (mode !== 'live' || flushing || !pending.length) return;
    var key = bridge.ensureKey ? await bridge.ensureKey(!!interactive) : null;
    if (!key) {
      needKey = true;
      setStatus('ยังไม่ได้บันทึกขึ้นชีต ' + pending.length + ' รายการ', true);
      renderBanner();
      return;
    }
    needKey = false;
    flushing = true;
    var sent = pending.slice();
    setStatus('กำลังบันทึก…', false);
    try {
      var res = await bridge.apiPost({ table: 'nonstock', expect: 'nonstock', key: key, ops: sent });
      if (res && res.ok) {
        if (bridge.setKey && bridge.getKey && bridge.getKey() !== key) bridge.setKey(key);
        pending = pending.slice(sent.length);
        savePending();
        if (Array.isArray(res.rows)) serverMoves = res.rows.map(M.normalizeMove);
        lastSaved = res.lastSaved || lastSaved;
        saveCache();
        setStatus('บันทึกแล้ว ' + fmtTime(lastSaved), false);
      } else if (res && res.auth === false) {
        if (bridge.clearKey) bridge.clearKey();
        needKey = true;
        setStatus(res.error || 'รหัสไม่ถูกต้อง', true);
      } else {
        setStatus((res && res.error) || 'บันทึกไม่สำเร็จ จะลองใหม่อัตโนมัติ', true);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(function () { retryTimer = null; flush(false); }, 15000);
      }
    } catch (e) {
      setStatus('ต่อชีตไม่ได้ จะลองบันทึกใหม่อัตโนมัติ', true);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { retryTimer = null; flush(false); }, 15000);
    } finally {
      flushing = false;
      renderAll();
      if (pending.length && !needKey && mode === 'live' && !retryTimer) scheduleFlush(300);
    }
  }

  function setStatus(txt, warn) {
    statusMsg = txt; statusWarn = !!warn;
    var el = $('#stkState');
    if (!el) return;
    el.classList.toggle('warn', !!warn);
    $('#stkStateTxt').textContent = txt;
  }

  // ---------- โครงหน้า ----------
  function renderShell() {
    var host = $('#viewStock');
    if (!host || $('#stkRoot')) return;
    host.innerHTML =
      '<div id="stkRoot">' +
      '<div class="banner" id="stkBanner"></div>' +
      '<div class="stk-head"><p class="sub">ตัดยอดตามวันที่เบิก · บันทึกอัตโนมัติ <span class="saveState" id="stkState"><i></i><span id="stkStateTxt">กำลังโหลด…</span></span></p>' +
      '<div class="topbtns"><button class="primary" id="stkAdd" type="button">+ บันทึกการเบิก</button>' +
      '<button id="stkNewItem" type="button">+ เพิ่มรายการวัสดุ</button>' +
      '<button id="stkReload" type="button">โหลดใหม่</button>' +
      '<button id="stkXlsx" type="button">ส่งออก Excel</button></div></div>' +
      '<div class="kpis" id="stkKpis"></div>' +
      '<div class="stk-cats" id="stkCats"></div>' +
      '<section class="card"><h2 id="stkTitle">รายการวัสดุ</h2><p class="desc">คงเหลือ = รับเข้า − เบิกใช้ + คืนคลัง · กดชื่อรายการเพื่อดูประวัติการเบิก</p>' +
      '<div class="toolbar stk"><input type="search" id="stkQ" class="full" placeholder="ค้นหา ชื่อ รหัส เลข SO โครงการ ผู้เบิก">' +
      '<select id="stkCat"></select>' +
      '<select id="stkSt"><option value="">ทุกสถานะ</option><option value="used">เบิกแล้ว</option><option value="low">เหลือน้อย</option><option value="zero">หมด / เบิกเกิน</option><option value="unused">ยังไม่เคยเบิก</option></select>' +
      '<select id="stkSort"><option value="file">เรียงตามไฟล์</option><option value="remainAsc">คงเหลือน้อย → มาก</option><option value="recent">เบิกล่าสุดก่อน</option><option value="usedDesc">เบิกมาก → น้อย</option><option value="name">ชื่อ ก–ฮ</option></select>' +
      '<button id="stkClear" type="button">ล้างตัวกรอง</button></div>' +
      '<p class="count" id="stkCount"></p>' +
      '<div class="tblwrap"><table class="stk-table"><thead><tr><th>#</th><th>รูป</th><th>รายการ</th><th>หน่วย</th><th class="num">รับเข้า</th><th class="num">เบิกแล้ว</th><th class="num">คงเหลือ</th><th>เบิกล่าสุด</th><th></th></tr></thead><tbody id="stkBody"></tbody></table></div>' +
      '</section>' +
      '<section class="card"><h2>ประวัติการเบิก</h2><p class="desc">เรียงวันที่ล่าสุดก่อน · ตามหมวดและคำค้นด้านบน · กด แก้ไข เพื่อแก้หรือลบ</p>' +
      '<div class="tblwrap"><table class="stk-table"><thead><tr><th>วันที่</th><th>ประเภท</th><th>รายการ</th><th class="num">จำนวน</th><th>เลขที่ SO</th><th>โครงการ</th><th>ผู้เบิก</th><th>ใบเบิก</th><th>หมายเหตุ</th><th></th></tr></thead><tbody id="stkHist"></tbody></table></div>' +
      '<div class="stk-more"><button id="stkMore" type="button" hidden>ดูเพิ่ม</button></div>' +
      '</section>' +
      '<section class="card"><details id="stkNotes"><summary><b>ข้อสังเกตจากไฟล์ Excel</b> <span class="muted" id="stkNotesN"></span></summary><ul id="stkNotesList"></ul></details></section>' +
      '</div>';

    var m = document.createElement('div');
    m.innerHTML =
      '<div class="mask" id="stkMask"><div class="modal" role="dialog" aria-modal="true">' +
      '<h3 id="stkMTitle">บันทึกการเบิก</h3>' +
      '<div class="fgrid">' +
      '<div class="f full" id="stkPickWrap"><label>รายการวัสดุ</label><input type="search" id="stkPickQ" placeholder="พิมพ์ชื่อหรือรหัสเพื่อค้นหา"><select id="stkPick" size="6"></select></div>' +
      '<div class="f full" id="stkFixedWrap"><label>รายการวัสดุ</label><div class="stk-fixed" id="stkFixed"></div></div>' +
      '<div class="f" id="stkNewCatWrap"><label>หมวด</label><select id="stkNewCat"></select></div>' +
      '<div class="f" id="stkNewCodeWrap"><label>รหัส/Part No.</label><input type="text" id="stkNewCode"></div>' +
      '<div class="f full" id="stkNewNameWrap"><label>ชื่อรายการ / รายละเอียด</label><input type="text" id="stkNewName"></div>' +
      '<div class="f" id="stkNewUnitWrap"><label>หน่วย</label><input type="text" id="stkNewUnit" list="stkUnits"></div>' +
      '<div class="f" id="stkTypeWrap"><label>ประเภท</label><select id="stkType"><option value="out">เบิกใช้</option><option value="ret">คืนคลัง</option><option value="in">รับเข้าเพิ่ม</option></select></div>' +
      '<div class="f"><label>วันที่</label><input type="date" id="stkDate"></div>' +
      '<div class="f"><label id="stkQtyLab">จำนวน</label><input type="number" id="stkQty" min="0" step="any" inputmode="decimal"></div>' +
      '<div class="f"><label>เลขที่ SO</label><input type="text" id="stkSo" placeholder="SO2611-064"></div>' +
      '<div class="f"><label>ผู้เบิก</label><input type="text" id="stkBy" list="stkPeople"></div>' +
      '<div class="f full"><label>โครงการ</label><input type="text" id="stkProject"></div>' +
      '<div class="f"><label>เลขที่ใบเบิก</label><input type="text" id="stkDoc" placeholder="FPU04-…"></div>' +
      '<div class="f"><label>หมายเหตุ</label><input type="text" id="stkNote"></div>' +
      '</div><p class="hint" id="stkMMsg"></p>' +
      '<div class="mact"><button class="danger left" id="stkMDel" type="button">ลบรายการนี้</button><button id="stkMCancel" type="button">ยกเลิก</button><button class="primary" id="stkMSave" type="button">บันทึก</button></div>' +
      '<datalist id="stkPeople"></datalist><datalist id="stkUnits"></datalist>' +
      '</div></div>' +
      '<div class="mask" id="stkItemMask"><div class="modal stk-item" role="dialog" aria-modal="true"><div id="stkItemBody"></div>' +
      '<div class="mact"><button id="stkItemClose" type="button">ปิด</button><button class="primary" id="stkItemOut" type="button">+ เบิกรายการนี้</button></div></div></div>';
    while (m.firstChild) document.body.appendChild(m.firstChild);
    bindShell();
  }

  function bindShell() {
    $('#stkAdd').addEventListener('click', function () { openForm(null, null, 'move'); });
    $('#stkNewItem').addEventListener('click', function () { openForm(null, null, 'item'); });
    $('#stkReload').addEventListener('click', function () { reload(); });
    $('#stkXlsx').addEventListener('click', exportXlsx);
    $('#stkQ').addEventListener('input', function (e) { f.q = e.target.value; histLimit = 40; renderTable(); renderHist(); });
    $('#stkCat').addEventListener('change', function (e) { f.cat = e.target.value; histLimit = 40; renderAll(); });
    $('#stkSt').addEventListener('change', function (e) { f.st = e.target.value; renderTable(); });
    $('#stkSort').addEventListener('change', function (e) { f.sort = e.target.value; renderTable(); });
    $('#stkClear').addEventListener('click', function () { f = { cat: '', q: '', st: '', sort: 'file' }; $('#stkQ').value = ''; renderAll(); });
    $('#stkMore').addEventListener('click', function () { histLimit += 60; renderHist(); });
    $('#stkCats').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-cat]');
      if (!b) return;
      f.cat = b.dataset.cat; histLimit = 40; renderAll();
    });
    $('#stkKpis').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-st]');
      if (!b) return;
      f.st = f.st === b.dataset.st ? '' : b.dataset.st; renderAll();
    });
    $('#stkBody').addEventListener('click', function (e) {
      var b = e.target.closest('[data-out]');
      if (b) { openForm(null, b.dataset.out, 'move'); return; }
      var v = e.target.closest('[data-item]');
      if (v) openItem(v.dataset.item);
    });
    $('#stkHist').addEventListener('click', function (e) {
      var b = e.target.closest('[data-edit]');
      if (b) { openForm(b.dataset.edit, null, 'move'); return; }
      var v = e.target.closest('[data-item]');
      if (v) openItem(v.dataset.item);
    });
    $('#stkBanner').addEventListener('click', function (e) {
      if (e.target.closest('[data-key]')) flush(true);
    });
    $('#stkPickQ').addEventListener('input', fillPick);
    $('#stkPick').addEventListener('change', paintPickInfo);
    $('#stkType').addEventListener('change', paintPickInfo);
    $('#stkMCancel').addEventListener('click', closeForm);
    $('#stkMSave').addEventListener('click', saveForm);
    $('#stkMDel').addEventListener('click', deleteFromForm);
    $('#stkMask').addEventListener('click', function (e) { if (e.target.id === 'stkMask') closeForm(); });
    $('#stkItemMask').addEventListener('click', function (e) {
      if (e.target.id === 'stkItemMask') closeItem();
      var b = e.target.closest('[data-edit]');
      if (b) { closeItem(); openForm(b.dataset.edit, null, 'move'); }
    });
    $('#stkItemClose').addEventListener('click', closeItem);
    $('#stkItemOut').addEventListener('click', function () { var id = $('#stkItemMask').dataset.item; closeItem(); openForm(null, id, 'move'); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('#stkMask').classList.contains('on')) closeForm();
      else if ($('#stkItemMask').classList.contains('on')) closeItem();
    });
  }

  // ---------- วาด ----------
  function renderAll() {
    if (!master || !$('#stkRoot')) return;
    compute();
    renderBanner();
    renderKpis();
    renderCats();
    renderFilters();
    renderTable();
    renderHist();
    renderNotes();
    setStatus(statusMsg || 'พร้อมใช้งาน', statusWarn);
  }

  function renderBanner() {
    var el = $('#stkBanner');
    if (!el) return;
    var html = '', bad = false;
    if (mode === 'local') {
      html = 'ตอนนี้แสดงยอดตามไฟล์ Excel · ชีตกลางยังไม่เปิดรับข้อมูลวัสดุนอกสต๊อก (ต้องอัปเดต Apps Script ตาม SETUP.md) การเบิกที่บันทึกตอนนี้<b>เก็บไว้ในเครื่องนี้ก่อน</b> แล้วจะส่งขึ้นชีตให้เองเมื่อพร้อม';
    } else if (mode === 'offline') {
      html = 'ต่อชีตไม่ได้ในตอนนี้ แสดงข้อมูลล่าสุดที่เครื่องนี้เคยโหลด';
      bad = true;
    } else if (mode === 'live' && needKey && pending.length) {
      html = 'มีการเบิก ' + pending.length + ' รายการที่ยังไม่ได้บันทึกขึ้นชีต <button type="button" data-key="1">ใส่รหัสแล้วบันทึก</button>';
      bad = true;
    }
    el.innerHTML = html;
    el.classList.toggle('on', !!html);
    el.classList.toggle('bad', bad);
  }

  function filtered(rows) {
    var q = f.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (f.cat && r.item.cat !== f.cat) return false;
      if (f.st === 'used' && !(r.out > 0)) return false;
      if (f.st === 'low' && r.status !== 'low') return false;
      if (f.st === 'zero' && r.status !== 'zero' && r.status !== 'over') return false;
      if (f.st === 'unused' && r.out > 0) return false;
      if (!q) return true;
      var hay = [r.item.name, r.item.code, r.item.note, r.item.unit].join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) return true;
      return r.moves.some(function (m) { return [m.so, m.project, m.by, m.doc, m.note].join(' ').toLowerCase().indexOf(q) >= 0; });
    });
  }

  function renderKpis() {
    var rows = f.cat ? rowsCache.filter(function (r) { return r.item.cat === f.cat; }) : rowsCache;
    var used = rows.filter(function (r) { return r.out > 0; }).length;
    var low = rows.filter(function (r) { return r.status === 'low'; }).length;
    var zero = rows.filter(function (r) { return r.status === 'zero' || r.status === 'over'; }).length;
    var outs = [];
    rows.forEach(function (r) { r.moves.forEach(function (m) { if (m.type === 'out') outs.push(m); }); });
    var last = outs.reduce(function (a, m) { return m.date > a ? m.date : a; }, '');
    function k(lab, val, sm, st, cls) {
      return '<button type="button" class="kpi ' + (cls || '') + (st && f.st === st ? ' on' : '') + '" ' + (st ? 'data-st="' + st + '"' : 'data-st=""') + '><div class="lab">' + lab + '</div><div class="val">' + val + '</div><div class="sm">' + sm + '</div></button>';
    }
    $('#stkKpis').innerHTML =
      k('รายการวัสดุ', rows.length, f.cat ? catName(f.cat) : 'ทุกหมวด ' + master.categories.length + ' หมวด', '') +
      k('เบิกแล้ว', used, 'รายการที่มีการเบิก', 'used') +
      k('เหลือน้อย', low, 'คงเหลือ ≤ 20% ของรับเข้า', 'low', low ? 'flag' : '') +
      k('หมดแล้ว', zero, 'คงเหลือ 0 หรือเบิกเกิน', 'zero', zero ? 'crit' : '') +
      k('ครั้งที่เบิก', outs.length, last ? 'ล่าสุด ' + M.thaiDate(last) : 'ยังไม่มีการเบิก', '');
  }

  function renderCats() {
    var sums = M.summarize(rowsCache, master.categories);
    var all = { items: rowsCache.length, touched: 0, low: 0, zero: 0, moves: 0 };
    sums.forEach(function (s) { all.touched += s.touched; all.low += s.low; all.zero += s.zero; all.moves += s.moves; });
    function card(id, name, s) {
      return '<button type="button" class="stk-cat' + (f.cat === id ? ' on' : '') + '" data-cat="' + id + '">' +
        '<span class="nm">' + esc(name) + '</span><span class="big">' + s.items + ' <small>รายการ</small></span>' +
        '<span class="sm">เบิกแล้ว ' + s.touched + ' · เบิก ' + s.moves + ' ครั้ง</span>' +
        '<span class="tags">' + (s.zero ? '<i class="tg zero">หมด ' + s.zero + '</i>' : '') + (s.low ? '<i class="tg low">เหลือน้อย ' + s.low + '</i>' : '') + (!s.zero && !s.low ? '<i class="tg ok">ปกติ</i>' : '') + '</span></button>';
    }
    $('#stkCats').innerHTML = card('', 'ทุกหมวด', all) + sums.map(function (s) { return card(s.id, s.name, s); }).join('');
  }

  function renderFilters() {
    var sel = $('#stkCat');
    sel.innerHTML = '<option value="">ทุกหมวด</option>' + master.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    sel.value = f.cat;
    $('#stkSt').value = f.st;
    $('#stkSort').value = f.sort;
    $('#stkTitle').textContent = f.cat ? 'รายการวัสดุ — ' + catName(f.cat) : 'รายการวัสดุทุกหมวด';
  }

  var ST_LABEL = { ok: '', low: 'เหลือน้อย', zero: 'หมด', over: 'เบิกเกิน' };
  function remainCell(r) {
    var pct = r.total > 0 ? Math.max(0, Math.min(100, r.remain / r.total * 100)) : 0;
    return '<td class="num rem ' + r.status + '"><b>' + fmtN(r.remain) + '</b>' + (ST_LABEL[r.status] ? ' <i class="tg ' + r.status + '">' + ST_LABEL[r.status] + '</i>' : '') +
      '<span class="rbar"><span style="width:' + pct.toFixed(1) + '%"></span></span></td>';
  }
  function hl(text) {
    var t = String(text || ''), q = f.q.trim();
    if (!q) return esc(t);
    var i = t.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return esc(t);
    return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
  }

  function renderTable() {
    var rows = filtered(rowsCache);
    var order = {};
    master.categories.forEach(function (c, i) { order[c.id] = i; });
    var s = f.sort;
    rows.sort(function (a, b) {
      if (s === 'remainAsc') return (a.total ? a.remain / a.total : 0) - (b.total ? b.remain / b.total : 0) || a.remain - b.remain;
      if (s === 'recent') return (b.lastOut || '').localeCompare(a.lastOut || '');
      if (s === 'usedDesc') return b.out - a.out;
      if (s === 'name') return a.item.name.localeCompare(b.item.name, 'th');
      return (order[a.item.cat] - order[b.item.cat]) || ((a.item.row || 1e9) - (b.item.row || 1e9));
    });
    $('#stkCount').innerHTML = 'แสดง <b>' + rows.length + '</b> จาก ' + rowsCache.length + ' รายการ';
    if (!rows.length) { $('#stkBody').innerHTML = '<tr><td colspan="9" class="empty">ไม่พบรายการตามตัวกรอง</td></tr>'; return; }
    var lastCat = null;
    $('#stkBody').innerHTML = rows.map(function (r, i) {
      var it = r.item, head = '';
      if (!f.cat && s === 'file' && it.cat !== lastCat) {
        lastCat = it.cat;
        head = '<tr class="plangroup"><td colspan="9">' + esc(catName(it.cat)) + '</td></tr>';
      }
      return head + '<tr class="st-' + r.status + '">' +
        '<td class="muted">' + (it.no || (i + 1)) + '</td>' +
        '<td class="img">' + (it.img ? '<img loading="lazy" src="' + esc(it.img) + '" alt="" data-item="' + esc(it.id) + '">' : '') + '</td>' +
        '<td class="nm"><button type="button" class="textbtn" data-item="' + esc(it.id) + '">' + hl(it.name) + '</button>' +
        '<small>' + (it.code ? hl(it.code) + ' · ' : '') + (f.cat ? '' : esc(catName(it.cat)) + ' · ') + (it.recv ? 'รับ ' + M.thaiDate(it.recv) : '') + (it.added ? ' · เพิ่มจากเว็บ' : '') + (it.note ? ' · ' + esc(it.note) : '') + '</small></td>' +
        '<td>' + esc(it.unit) + '</td>' +
        '<td class="num">' + fmtN(r.total) + '</td>' +
        '<td class="num">' + (r.used ? fmtN(r.used) : '<span class="muted">–</span>') + '</td>' +
        remainCell(r) +
        '<td class="dt">' + (r.lastOut ? M.thaiDate(r.lastOut) : '<span class="muted">–</span>') + '</td>' +
        '<td class="act"><button type="button" data-out="' + esc(it.id) + '">เบิก</button></td></tr>';
    }).join('');
  }

  function histRows() {
    var q = f.q.trim().toLowerCase();
    var byId = {};
    rowsCache.forEach(function (r) { byId[r.item.id] = r.item; });
    var list = moves().filter(function (m) {
      var it = byId[m.itemId];
      if (!it) return false;
      if (f.cat && it.cat !== f.cat) return false;
      if (!q) return true;
      return [it.name, it.code, m.so, m.project, m.by, m.doc, m.note].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    list.sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || ''); });
    return { list: list, byId: byId };
  }

  function renderHist() {
    var h = histRows();
    var pend = {};
    pending.forEach(function (op) { if (op.op === 'upsert' && op.row) pend[op.row.id] = 1; });
    if (!h.list.length) { $('#stkHist').innerHTML = '<tr><td colspan="10" class="empty">ยังไม่มีประวัติการเบิก</td></tr>'; $('#stkMore').hidden = true; return; }
    $('#stkHist').innerHTML = h.list.slice(0, histLimit).map(function (m) {
      var it = h.byId[m.itemId];
      var t = M.TYPES[m.type] || M.TYPES.out;
      return '<tr><td class="dt">' + M.thaiDate(m.date) + '</td>' +
        '<td><i class="tg mv-' + m.type + '">' + t.label + '</i></td>' +
        '<td class="nm"><button type="button" class="textbtn" data-item="' + esc(it.id) + '">' + esc(it.name) + '</button><small>' + esc(catName(it.cat)) + '</small></td>' +
        '<td class="num"><b>' + (t.sign < 0 ? '−' : '+') + fmtN(m.qty) + '</b> ' + esc(it.unit) + '</td>' +
        '<td class="so">' + esc(m.so) + '</td><td class="work">' + esc(m.project) + '</td><td>' + esc(m.by) + '</td><td>' + esc(m.doc) + '</td>' +
        '<td class="work">' + esc(m.note) + (pend[m.id] ? ' <i class="tg low">รอส่ง</i>' : '') + '</td>' +
        '<td class="act"><button type="button" data-edit="' + esc(m.id) + '">แก้ไข</button></td></tr>';
    }).join('');
    $('#stkMore').hidden = h.list.length <= histLimit;
  }

  function renderNotes() {
    var notes = master.fileNotes || [];
    $('#stkNotesN').textContent = notes.length ? '(' + notes.length + ' ข้อ)' : '';
    $('#stkNotesList').innerHTML = notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
  }

  // ---------- รายละเอียดรายการ ----------
  function openItem(id) {
    var r = rowsCache.find(function (x) { return x.item.id === id; });
    if (!r) return;
    var it = r.item;
    $('#stkItemMask').dataset.item = id;
    $('#stkItemBody').innerHTML =
      '<div class="stk-ihead">' + (it.img ? '<img src="' + esc(it.img) + '" alt="">' : '') +
      '<div><h3>' + esc(it.name) + '</h3><p class="desc">' + esc(catName(it.cat)) + (it.code ? ' · รหัส ' + esc(it.code) : '') + ' · หน่วย ' + esc(it.unit) + (it.recv ? ' · รับเข้า ' + M.thaiDate(it.recv) : '') + (it.note ? ' · ' + esc(it.note) : '') + '</p>' +
      '<div class="stk-nums"><span>รับเข้า<b>' + fmtN(r.total) + '</b></span><span>เบิกแล้ว<b>' + fmtN(r.used) + '</b></span><span class="rem ' + r.status + '">คงเหลือ<b>' + fmtN(r.remain) + '</b></span></div></div></div>' +
      '<h4>ประวัติการเบิก</h4>' +
      (r.moves.length ? '<div class="rlist">' + r.moves.map(function (m) {
        var t = M.TYPES[m.type] || M.TYPES.out;
        return '<div class="rrow"><span class="cnt">' + M.thaiDate(m.date) + '</span><i class="tg mv-' + m.type + '">' + t.label + '</i>' +
          '<span class="nm">' + (t.sign < 0 ? '−' : '+') + fmtN(m.qty) + ' ' + esc(it.unit) + (m.so ? ' · ' + esc(m.so) : '') + (m.project ? ' · ' + esc(m.project) : '') +
          '<small class="muted">' + [m.by, m.doc, m.note].filter(Boolean).map(esc).join(' · ') + '</small></span>' +
          '<span class="ops"><button type="button" data-edit="' + esc(m.id) + '">แก้ไข</button></span></div>';
      }).join('') + '</div>' : '<p class="muted">ยังไม่มีการเบิก</p>');
    $('#stkItemMask').classList.add('on');
  }
  function closeItem() { $('#stkItemMask').classList.remove('on'); }

  // ---------- ฟอร์มเบิก ----------
  function fillPick() {
    var q = $('#stkPickQ').value.trim().toLowerCase();
    var sel = $('#stkPick');
    var keep = sel.value;
    var list = rowsCache.filter(function (r) {
      if (!q) return !f.cat || r.item.cat === f.cat;
      return (r.item.name + ' ' + r.item.code).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 300);
    sel.innerHTML = list.map(function (r) {
      return '<option value="' + esc(r.item.id) + '">' + esc(r.item.name) + ' — คงเหลือ ' + fmtN(r.remain) + ' ' + esc(r.item.unit) + '</option>';
    }).join('');
    if (keep && list.some(function (r) { return r.item.id === keep; })) sel.value = keep;
    else if (list.length === 1) sel.value = list[0].item.id;
    paintPickInfo();
  }
  function currentItemId() {
    if (editing && editing.fixedItem) return editing.fixedItem;
    return $('#stkPick').value;
  }
  function paintPickInfo() {
    var id = currentItemId();
    var r = rowsCache.find(function (x) { return x.item.id === id; });
    if (editing && editing.kind === 'item') { $('#stkQtyLab').textContent = 'จำนวนรับเข้า'; return; }
    var lab = 'จำนวน';
    if (r) lab += ' (' + (r.item.unit || 'หน่วย') + ') · คงเหลือ ' + fmtN(r.remain);
    $('#stkQtyLab').textContent = lab;
    if (editing && editing.fixedItem && r) {
      $('#stkFixed').innerHTML = '<b>' + esc(r.item.name) + '</b><small>' + esc(catName(r.item.cat)) + (r.item.code ? ' · ' + esc(r.item.code) : '') + ' · คงเหลือ ' + fmtN(r.remain) + ' ' + esc(r.item.unit) + '</small>';
    }
  }

  function show(id, on) { $(id).style.display = on ? '' : 'none'; }

  function openForm(moveId, itemId, kind) {
    var mv = moveId ? moves().find(function (m) { return m.id === moveId; }) : null;
    if (mv && mv.type === 'item') kind = 'item';
    editing = { id: mv ? mv.id : null, fixedItem: mv ? mv.itemId : (itemId || null), kind: kind };
    if (kind === 'item' && !mv) editing.fixedItem = null;
    var isItem = kind === 'item';
    $('#stkMTitle').textContent = isItem ? (mv ? 'แก้ไขรายการวัสดุที่เพิ่ม' : 'เพิ่มรายการวัสดุใหม่') : (mv ? 'แก้ไขการเบิก' : 'บันทึกการเบิก');
    show('#stkPickWrap', !isItem && !editing.fixedItem);
    show('#stkFixedWrap', !isItem && !!editing.fixedItem);
    ['#stkNewCatWrap', '#stkNewCodeWrap', '#stkNewNameWrap', '#stkNewUnitWrap'].forEach(function (s) { show(s, isItem); });
    show('#stkTypeWrap', !isItem);
    $('#stkNewCat').innerHTML = master.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('');
    var people = {}, units = {};
    moves().forEach(function (m) { if (m.by) m.by.split(' / ').forEach(function (p) { people[p] = 1; }); });
    master.items.forEach(function (i) { if (i.unit) units[i.unit] = 1; });
    $('#stkPeople').innerHTML = Object.keys(people).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    $('#stkUnits').innerHTML = Object.keys(units).map(function (p) { return '<option value="' + esc(p) + '">'; }).join('');
    $('#stkPickQ').value = '';
    $('#stkType').value = mv ? mv.type : 'out';
    $('#stkDate').value = mv ? mv.date : todayIso();
    $('#stkQty').value = mv ? mv.qty : '';
    $('#stkSo').value = mv ? mv.so : '';
    $('#stkBy').value = mv ? mv.by : '';
    $('#stkProject').value = mv ? mv.project : '';
    $('#stkDoc').value = mv ? mv.doc : '';
    $('#stkNote').value = mv ? mv.note : '';
    $('#stkNewCat').value = mv && isItem ? (mv.cat || 'misc') : (f.cat || 'misc');
    $('#stkNewCode').value = mv && isItem ? mv.code : '';
    $('#stkNewName').value = mv && isItem ? mv.name : '';
    $('#stkNewUnit').value = mv && isItem ? mv.unit : '';
    $('#stkMDel').style.display = mv ? '' : 'none';
    $('#stkMMsg').textContent = mv && mv.src === 'file' ? 'รายการนี้นำเข้าจากไฟล์ Excel แก้หรือลบได้ ยอดคงเหลือจะคำนวณใหม่ทันที' : '';
    if (!isItem && !editing.fixedItem) fillPick(); else paintPickInfo();
    $('#stkMask').classList.add('on');
    setTimeout(function () { (isItem ? $('#stkNewName') : (editing.fixedItem ? $('#stkQty') : $('#stkPickQ'))).focus(); }, 30);
  }
  function closeForm() { $('#stkMask').classList.remove('on'); editing = null; }

  function bad(el, msg) {
    el.style.outline = '2px solid var(--crit)';
    $('#stkMMsg').textContent = msg;
    el.focus();
    setTimeout(function () { el.style.outline = ''; }, 2500);
  }

  function saveForm() {
    if (!editing) return;
    var isItem = editing.kind === 'item';
    var qty = M.num($('#stkQty').value);
    var date = $('#stkDate').value;
    var old = editing.id ? moves().find(function (m) { return m.id === editing.id; }) : null;
    var row;
    if (isItem) {
      var name = $('#stkNewName').value.trim();
      if (!name) return bad($('#stkNewName'), 'ใส่ชื่อรายการ');
      if (!(qty >= 0) || $('#stkQty').value === '') return bad($('#stkQty'), 'ใส่จำนวนรับเข้า');
      row = { id: old ? old.id : M.newId('n'), itemId: old ? old.itemId : M.newId('new-'), type: 'item', cat: $('#stkNewCat').value, code: $('#stkNewCode').value.trim(), name: name, unit: $('#stkNewUnit').value.trim() };
    } else {
      var itemId = currentItemId();
      if (!itemId) return bad($('#stkPickQ'), 'เลือกรายการวัสดุก่อน');
      if (!(qty > 0)) return bad($('#stkQty'), 'ใส่จำนวนมากกว่า 0');
      var r = rowsCache.find(function (x) { return x.item.id === itemId; });
      var type = $('#stkType').value;
      if (type === 'out' && r) {
        var avail = r.remain + (old && old.type === 'out' && old.itemId === itemId ? old.qty : 0);
        if (qty > avail && !confirm('เบิก ' + fmtN(qty) + ' แต่คงเหลือ ' + fmtN(avail) + ' ' + (r.item.unit || '') + ' ยืนยันบันทึกหรือไม่? (ยอดจะติดลบ)')) return;
      }
      row = { id: old ? old.id : M.newId('w'), itemId: itemId, type: type, cat: r ? r.item.cat : '', code: r ? r.item.code : '', name: r ? r.item.name : '', unit: r ? r.item.unit : '' };
    }
    if (!date) return bad($('#stkDate'), 'ใส่วันที่');
    row.date = date;
    row.qty = qty;
    row.so = $('#stkSo').value.trim();
    row.project = $('#stkProject').value.trim();
    row.by = $('#stkBy').value.trim();
    row.doc = $('#stkDoc').value.trim();
    row.note = $('#stkNote').value.trim();
    row.src = old ? old.src : 'web';
    closeForm();
    queue({ op: 'upsert', row: M.normalizeMove(row) });
  }

  function deleteFromForm() {
    if (!editing || !editing.id) return;
    var mv = moves().find(function (m) { return m.id === editing.id; });
    if (!mv) return closeForm();
    var it = rowsCache.find(function (x) { return x.item.id === mv.itemId; });
    var nm = it ? it.item.name : 'รายการนี้';
    if (!confirm('ลบ' + (mv.type === 'item' ? 'รายการวัสดุ' : 'การเบิก') + ' "' + nm + '" ' + M.thaiDate(mv.date) + ' จำนวน ' + fmtN(mv.qty) + ' ใช่หรือไม่?')) return;
    var ops = [{ op: 'delete', id: mv.id }];
    if (mv.type === 'item') {
      moves().forEach(function (m) { if (m.itemId === mv.itemId && m.id !== mv.id) ops.push({ op: 'delete', id: m.id }); });
    }
    closeForm();
    ops.forEach(function (op) { pending.push(op); });
    savePending();
    renderAll();
    kick();
  }

  // ---------- ส่งออก Excel ----------
  async function exportXlsx() {
    var btn = $('#stkXlsx'); var prev = btn.textContent;
    btn.disabled = true; btn.textContent = 'กำลังเตรียมไฟล์…';
    try {
      if (bridge.loadSheetJS) await bridge.loadSheetJS();
      var X = root.XLSX;
      var wb = X.utils.book_new();
      var head = ['หมวด', 'ลำดับ', 'รหัส/Part No.', 'ชื่อรายการ / รายละเอียด', 'หน่วย', 'วันที่รับเข้า', 'รับเข้า', 'เบิกใช้', 'คืนคลัง', 'คงเหลือ', 'สถานะ', 'เบิกล่าสุด'];
      function line(r) { return [catName(r.item.cat), r.item.no || '', r.item.code, r.item.name, r.item.unit, M.thaiDate(r.item.recv), r.total, r.out, r.ret, r.remain, ST_LABEL[r.status] || 'ปกติ', M.thaiDate(r.lastOut)]; }
      var all = X.utils.aoa_to_sheet([head].concat(rowsCache.map(line)));
      all['!cols'] = [24, 6, 18, 60, 8, 12, 9, 9, 9, 9, 10, 12].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, all, 'สรุปคงเหลือ');
      master.categories.forEach(function (c) {
        var ws = X.utils.aoa_to_sheet([head].concat(rowsCache.filter(function (r) { return r.item.cat === c.id; }).map(line)));
        ws['!cols'] = all['!cols'];
        X.utils.book_append_sheet(wb, ws, c.name.slice(0, 31));
      });
      var byId = {}; rowsCache.forEach(function (r) { byId[r.item.id] = r.item; });
      var hs = X.utils.aoa_to_sheet([['วันที่', 'ประเภท', 'หมวด', 'รหัส', 'รายการ', 'จำนวน', 'หน่วย', 'เลขที่ SO', 'โครงการ', 'ผู้เบิก', 'เลขที่ใบเบิก', 'หมายเหตุ']].concat(moves().slice().sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); }).filter(function (m) { return byId[m.itemId]; }).map(function (m) {
        var it = byId[m.itemId];
        return [M.thaiDate(m.date), (M.TYPES[m.type] || M.TYPES.out).label, catName(it.cat), it.code, it.name, m.qty, it.unit, m.so, m.project, m.by, m.doc, m.note];
      })));
      hs['!cols'] = [12, 12, 24, 18, 60, 8, 8, 14, 36, 22, 16, 30].map(function (w) { return { wch: w }; });
      X.utils.book_append_sheet(wb, hs, 'ประวัติการเบิก');
      X.writeFile(wb, 'วัสดุนอกสต๊อก_' + todayIso() + '.xlsx');
    } catch (e) {
      alert('ส่งออก Excel ไม่ได้ในตอนนี้');
    } finally {
      btn.disabled = false; btn.textContent = prev;
    }
  }

  root.PEStock = {
    bind: function (b) { bridge = b || {}; },
    onShow: function () {
      if (!booted) { boot(); return; }
      if (mode === 'live' && Date.now() - lastLoad > 60000 && !flushing && !pending.length) reload();
      else renderAll();
    },
    state: function () { return { mode: mode, pending: pending.length, moves: moves().length, items: rowsCache.length, flushing: flushing, needKey: needKey, retry: !!retryTimer }; }
  };
})(typeof self !== 'undefined' ? self : this);
